import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { rateLimit } from 'express-rate-limit';
import type pg from 'pg';
import { requireAuth } from './auth.js';
import { chatEvents } from './chat.js';
const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, fieldSize: 8000, parts: 2 } }).single('file');
export function createAttachments(pool: pg.Pool, origin: string) {
  const router = Router();
  const access = `SELECT a.id,a.canceled_at FROM activities a WHERE a.id=$1 AND (a.creator_id=$2 OR EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id=a.id AND p.user_id=$2))`;
  router.post('/activities/:id/attachments', requireAuth,
    rateLimit({ windowMs: 60000, limit: 5, keyGenerator: req => req.session.userId!, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait a minute before uploading more files.' } }),
    async (req, res, next) => {
      if (!uuid.test(String(req.params.id))) { res.status(400).json({ error: 'Invalid activity ID.' }); return; }
      if (req.get('origin') !== origin || !req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) { res.status(403).json({ error: 'Refresh and try again.' }); return; }
      const result = await pool.query(access, [req.params.id, req.session.userId]);
      if (!result.rowCount) { res.status(403).json({ error: 'Join this activity before sharing files.' }); return; }
      if (result.rows[0].canceled_at) { res.status(409).json({ error: 'Canceled activity chat is read-only.' }); return; }
      upload(req, res, error => {
        if (error) { res.status(400).json({ error: 'Choose one photo or video, no larger than 25 MB, with an optional caption.' }); return; } next();
      });
    }, async (req, res) => {
      if (!req.file?.buffer.length) { res.status(400).json({ error: 'Choose a photo or video.' }); return; }
      let detected;
      try { detected = await fileTypeFromBuffer(req.file.buffer); } catch { /* Invalid file signature */ }
      if (!detected || !allowed.includes(detected.mime)) { res.status(400).json({ error: 'Supported files: JPEG, PNG, WebP, GIF, MP4, WebM, and MOV.' }); return; }
      if (detected.mime.startsWith('image/') && req.file.size > 10 * 1024 * 1024) { res.status(400).json({ error: 'Photos must be 10 MB or smaller.' }); return; }
      const caption = req.body?.body ?? '';
      if (typeof caption !== 'string' || caption.trim().length > 2000 || Object.keys(req.body || {}).some(key => key !== 'body')) { res.status(400).json({ error: 'Caption must be at most 2000 characters.' }); return; }
      const filename = req.file.originalname.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0,180) || `attachment.${detected.ext}`;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Recheck after upload while holding the same lock used by leave/cancel.
        const activity = await client.query('SELECT id FROM activities WHERE id=$1 FOR SHARE', [req.params.id]);
        const member = await client.query(access, [req.params.id, req.session.userId]);
        if (!activity.rowCount || !member.rowCount || member.rows[0].canceled_at) { await client.query('ROLLBACK'); res.status(403).json({ error: 'This activity no longer allows you to share files.' }); return; }
        const message = await client.query('INSERT INTO activity_messages (activity_id,user_id,body) VALUES ($1,$2,$3) RETURNING id', [req.params.id, req.session.userId, caption.trim() || filename]);
        const attachment = await client.query('INSERT INTO message_attachments (message_id,filename,mime_type,content,size) VALUES ($1,$2,$3,$4,$5) RETURNING id', [message.rows[0].id, filename, detected.mime, req.file.buffer, req.file.size]);
        await client.query('COMMIT'); chatEvents.emit('changed', String(req.params.id));
        res.status(201).json({ messageId: message.rows[0].id, attachmentId: attachment.rows[0].id });
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    });
  router.get('/attachments/:id', requireAuth, async (req, res) => {
    if (!uuid.test(String(req.params.id))) { res.status(400).json({ error: 'Invalid attachment ID.' }); return; }
    const result = await pool.query(`SELECT f.filename,f.mime_type,f.size,f.content FROM message_attachments f JOIN activity_messages m ON m.id=f.message_id JOIN activities a ON a.id=m.activity_id WHERE f.id=$1 AND (a.creator_id=$2 OR EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id=a.id AND p.user_id=$2))`, [req.params.id, req.session.userId]);
    if (!result.rowCount) { res.status(404).json({ error: 'Attachment unavailable.' }); return; }
    const file = result.rows[0];
    res.set({ 'Content-Type': file.mime_type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${file.filename}"`, 'Accept-Ranges': 'bytes', 'Cross-Origin-Resource-Policy': 'same-origin' });
    const range = req.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0, end = file.size - 1;
      if (!match || (!match[1] && !match[2])) { res.status(416).set('Content-Range', `bytes */${file.size}`).end(); return; }
      if (!match[1]) start = Math.max(0, file.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) { res.status(416).set('Content-Range', `bytes */${file.size}`).end(); return; }
      res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(end - start + 1) }).end(file.content.subarray(start, end + 1)); return;
    }
    res.set('Content-Length', String(file.size)).end(file.content);
  });
  return router;
}
