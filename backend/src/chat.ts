import { Router, type RequestHandler, type Request } from 'express';
import type pg from 'pg';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from './auth.js';
export const chatEvents = new EventEmitter();
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function createChat(pool: pg.Pool, origin: string) {
  const router = Router();
  router.use('/activities/:id/messages', requireAuth, (req, res, next) => {
    if (!uuid.test(String(req.params.id))) { res.status(400).json({ error: 'Invalid activity ID.' }); return; } next();
  });
  const limiter = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => req.session.userId!, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait a minute before sending more messages.' } });
  router.post('/activities/:id/messages', limiter);
  router.route('/activities/:id/messages').all(async (req, res, next) => {
    if (!['GET', 'POST'].includes(req.method)) { next(); return; }
    if (req.method === 'POST' && (req.get('origin') !== origin || !req.session.csrf || req.get('x-csrf-token') !== req.session.csrf)) { res.status(403).json({ error: 'Refresh and try again.' }); return; }
    const before = req.query.before;
    if (req.method === 'GET' && before !== undefined && (typeof before !== 'string' || !/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n)) { res.status(400).json({ error: 'Invalid message cursor.' }); return; }
    if (req.method === 'POST' && (!req.body || typeof req.body.body !== 'string' || !req.body.body.trim() || req.body.body.trim().length > 2000 || Object.keys(req.body).some(key => key !== 'body'))) { res.status(400).json({ error: 'Messages must contain 1–2000 characters.' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize membership changes and cancellation with reads/writes.
      const activity = await client.query('SELECT creator_id,canceled_at FROM activities WHERE id=$1 FOR SHARE', [req.params.id]);
      if (!activity.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Activity not found.' }); return; }
      const member = await client.query('SELECT 1 FROM activity_participants WHERE activity_id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
      if (!member.rowCount && activity.rows[0].creator_id !== req.session.userId) { await client.query('ROLLBACK'); res.status(403).json({ error: 'Join this activity to read and send messages.' }); return; }
      if (req.method === 'GET') {
        const result = await client.query("SELECT m.id,m.body,m.created_at,m.user_id,u.display_name, (SELECT json_build_object('id',f.id,'filename',f.filename,'mime_type',f.mime_type,'size',f.size) FROM message_attachments f WHERE f.message_id=m.id) AS attachment FROM activity_messages m JOIN users u ON u.id=m.user_id WHERE m.activity_id=$1 AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 51", [req.params.id, before || null]);
        await client.query('COMMIT'); res.json({ messages: result.rows.slice(0,50).reverse(), hasMore: result.rows.length > 50, readOnly: !!activity.rows[0].canceled_at });
      } else {
        if (activity.rows[0].canceled_at) { await client.query('ROLLBACK'); res.status(409).json({ error: 'This activity is canceled. Chat history is read-only.' }); return; }
        const result = await client.query('INSERT INTO activity_messages (activity_id,user_id,body) VALUES ($1,$2,$3) RETURNING id,body,created_at,user_id', [req.params.id, req.session.userId, req.body.body.trim()]);
        const user = await client.query('SELECT display_name FROM users WHERE id=$1', [req.session.userId]);
        await client.query('COMMIT');
        // Live events carry no message text; recipients reauthorize through HTTP.
        chatEvents.emit('changed', String(req.params.id));
        res.status(201).json({ message: { ...result.rows[0], display_name: user.rows[0].display_name } });
      }
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  return router;
}
export function attachChat(server: HttpServer, middleware: RequestHandler, pool: pg.Pool, origin: string) {
  const io = new Server(server, { path: '/socket.io', maxHttpBufferSize: 4096, allowRequest: (req, callback) => callback(null, req.headers.origin === origin) });
  io.engine.use(middleware);
  io.use((socket, next) => { const req = socket.request as Request; if (!req.session?.userId) { next(new Error('Sign in required.')); return; } next(); });
  io.on('connection', socket => {
    let lastJoin = 0;
    socket.on('watch', async (id: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      const reply = ack as (result: { ok: boolean }) => void;
      if (typeof id !== 'string' || !uuid.test(id) || Date.now() - lastJoin < 500) { reply({ ok: false }); return; }
      lastJoin = Date.now();
      try {
        const req = socket.request as Request;
        await new Promise<void>((resolve, reject) => req.session.reload(error => error ? reject(error) : resolve()));
        const member = await pool.query('SELECT 1 FROM activities a WHERE a.id=$1 AND (a.creator_id=$2 OR EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id=a.id AND p.user_id=$2))', [id, req.session.userId]);
        if (!member.rowCount) { reply({ ok: false }); return; }
        for (const room of socket.rooms) if (room !== socket.id) await socket.leave(room);
        await socket.join(id); reply({ ok: true });
      } catch { reply({ ok: false }); }
    });
  });
  const notify = (id: string) => {
    void (async () => {
      for (const socket of await io.in(id).fetchSockets()) {
        try {
          const local = io.sockets.sockets.get(socket.id);
          if (!local) continue;
          const req = local.request as Request;
          await new Promise<void>((resolve, reject) => req.session.reload(error => error ? reject(error) : resolve()));
          const member = await pool.query('SELECT 1 FROM activities a WHERE a.id=$1 AND (a.creator_id=$2 OR EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id=a.id AND p.user_id=$2))', [id, req.session.userId]);
          if (!member.rowCount) { local.emit('access-revoked'); await local.leave(id); continue; }
          local.emit('messages-changed');
        } catch { socket.disconnect(); }
      }
    })().catch(() => console.error('Live chat update failed.'));
  };
  chatEvents.on('changed', notify);
  server.once('close', () => chatEvents.off('changed', notify));
  return io;
}
