import { Router } from 'express';
import type pg from 'pg';
import { requireAuth } from './auth.js';
import { rateLimit } from 'express-rate-limit';
export const categories = ['Sports', 'Study', 'Social', 'Creative', 'Gaming', 'Outdoors'];
const fields = ['title', 'description', 'category', 'location', 'starts_at', 'ends_at', 'capacity'];
function validate(body: Record<string, unknown>) {
  for (const [field, max] of [['title', 120], ['description', 2000], ['location', 200]] as const) {
    if (typeof body[field] !== 'string' || (body[field] as string).trim().length > max || (field !== 'description' && !(body[field] as string).trim())) return `${field} must contain ${field === 'description' ? '0' : '1'}–${max} characters.`;
  }
  if (!categories.includes(String(body.category))) return 'Choose a listed category.';
  if (!Number.isInteger(body.capacity) || Number(body.capacity) < 1 || Number(body.capacity) > 500) return 'Capacity must be between 1 and 500, including you.';
  const start = typeof body.starts_at === 'string' ? Date.parse(body.starts_at) : NaN;
  const end = typeof body.ends_at === 'string' ? Date.parse(body.ends_at) : NaN;
  if (!Number.isFinite(start) || start <= Date.now() || !Number.isFinite(end) || end <= start) return 'Choose a future start time and an end time after it.';
}
const selection = `a.*, u.display_name AS host_name, (SELECT count(*)::int FROM activity_participants p WHERE p.activity_id=a.id) AS participant_count`;
export function createActivities(pool: pg.Pool, origin: string) {
  const router = Router();
  router.use(requireAuth);
  router.get('/activity-categories', (_req, res) => res.json({ categories }));
  router.get('/activities', async (req, res) => {
    const page = Number(req.query.page || 1), limit = Number(req.query.limit || 12);
    const category = req.query.category, date = req.query.date;
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50 || (category !== undefined && !categories.includes(String(category))) || (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date))) { res.status(400).json({ error: 'Invalid feed filters.' }); return; }
    const result = await pool.query(`SELECT ${selection} FROM activities a JOIN users u ON u.id=a.creator_id WHERE a.canceled_at IS NULL AND a.starts_at>now() AND ($1::text IS NULL OR a.category=$1) AND ($2::text IS NULL OR (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date=$2::date) ORDER BY a.starts_at,a.id LIMIT $3 OFFSET $4`, [category || null, date || null, limit + 1, (page - 1) * limit]);
    res.json({ activities: result.rows.slice(0, limit), hasMore: result.rows.length > limit });
  });
  router.use('/activities/:id', (req, res, next) => {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(req.params.id))) { res.status(400).json({ error: 'Invalid activity ID.' }); return; } next();
  });
  router.get('/activities/:id', async (req, res) => {
    const result = await pool.query(`SELECT ${selection} FROM activities a JOIN users u ON u.id=a.creator_id WHERE a.id=$1`, [req.params.id]);
    if (!result.rowCount) { res.status(404).json({ error: 'Activity not found.' }); return; }
    res.json({ activity: result.rows[0] });
  });
  router.use('/activities', (req, res, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(req.method) && (req.get('origin') !== origin || !req.session.csrf || req.get('x-csrf-token') !== req.session.csrf)) { res.status(403).json({ error: 'Refresh and try again.' }); return; } next();
  });
  router.get('/activities/:id/participants', async (req, res) => {
    const activity = await pool.query('SELECT creator_id FROM activities WHERE id=$1', [req.params.id]);
    if (!activity.rowCount) { res.status(404).json({ error: 'Activity not found.' }); return; }
    const people = await pool.query('SELECT u.id, u.display_name, p.joined_at FROM activity_participants p JOIN users u ON u.id=p.user_id WHERE p.activity_id=$1 ORDER BY p.joined_at,u.id', [req.params.id]);
    res.json({ participants: people.rows, hostId: activity.rows[0].creator_id });
  });
  const participationLimit = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => req.session.userId!, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait a minute before changing participation again.' } });
  for (const action of ['join', 'leave']) {
    router[action === 'join' ? 'post' : 'delete'](`/activities/:id/${action === 'join' ? 'join' : 'participants/me'}`, participationLimit, async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query('SELECT * FROM activities WHERE id=$1 FOR UPDATE', [req.params.id]);
        const activity = result.rows[0];
        const reject = async (status: number, error: string) => { await client.query('ROLLBACK'); res.status(status).json({ error }); };
        if (!activity) { await reject(404, 'Activity not found.'); return; }
        if (activity.creator_id === req.session.userId) { await reject(409, action === 'join' ? 'You are already participating as the host.' : 'The host cannot leave. Cancel the activity instead.'); return; }
        if (action === 'join') {
          if (activity.canceled_at || new Date(activity.starts_at).getTime() <= Date.now()) { await reject(409, 'This activity has been canceled or already started.'); return; }
          const user = await client.query('SELECT profile_completed_at FROM users WHERE id=$1', [req.session.userId]);
          if (!user.rows[0]?.profile_completed_at) { await reject(403, 'Save your profile before joining an activity.'); return; }
          const existing = await client.query('SELECT 1 FROM activity_participants WHERE activity_id=$1 AND user_id=$2', [activity.id, req.session.userId]);
          if (existing.rowCount) { await reject(409, 'You have already joined this activity.'); return; }
          const count = await client.query('SELECT count(*)::int AS total FROM activity_participants WHERE activity_id=$1', [activity.id]);
          if (count.rows[0].total >= activity.capacity) { await reject(409, 'This activity is full.'); return; }
          await client.query('INSERT INTO activity_participants (activity_id,user_id) VALUES ($1,$2)', [activity.id, req.session.userId]);
        } else {
          const removed = await client.query('DELETE FROM activity_participants WHERE activity_id=$1 AND user_id=$2 RETURNING user_id', [activity.id, req.session.userId]);
          if (!removed.rowCount) { await reject(409, 'You are not participating in this activity.'); return; }
        }
        await client.query('COMMIT'); res.status(action === 'join' ? 201 : 200).json({ ok: true });
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    });
  }
  router.post('/activities', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) { res.status(400).json({ error: 'Invalid activity fields.' }); return; }
    const error = validate(body); if (error) { res.status(400).json({ error }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = await client.query('SELECT profile_completed_at FROM users WHERE id=$1', [req.session.userId]);
      if (!profile.rows[0]?.profile_completed_at) { await client.query('ROLLBACK'); res.status(403).json({ error: 'Save your profile before hosting an activity.' }); return; }
      const result = await client.query('INSERT INTO activities (creator_id,title,description,category,location,starts_at,ends_at,capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.userId, body.title.trim(), body.description.trim(), body.category, body.location.trim(), body.starts_at, body.ends_at, body.capacity]);
      await client.query('INSERT INTO activity_participants (activity_id,user_id) VALUES ($1,$2)', [result.rows[0].id, req.session.userId]);
      await client.query('COMMIT'); res.status(201).json({ activity: result.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  for (const action of ['edit', 'cancel']) {
    router[action === 'edit' ? 'patch' : 'post'](`/activities/:id${action === 'cancel' ? '/cancel' : ''}`, async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query('SELECT * FROM activities WHERE id=$1 FOR UPDATE', [req.params.id]);
        const activity = result.rows[0];
        if (!activity || activity.creator_id !== req.session.userId) { await client.query('ROLLBACK'); res.status(activity ? 403 : 404).json({ error: activity ? 'Only the host can change this activity.' : 'Activity not found.' }); return; }
        if (activity.canceled_at || new Date(activity.starts_at).getTime() <= Date.now()) { await client.query('ROLLBACK'); res.status(409).json({ error: 'This activity has been canceled or already started.' }); return; }
        if (action === 'cancel') await client.query('UPDATE activities SET canceled_at=now() WHERE id=$1', [activity.id]);
        else {
          const body = req.body;
          if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !fields.includes(key))) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Invalid activity fields.' }); return; }
          const merged = { ...activity, starts_at: activity.starts_at.toISOString(), ends_at: activity.ends_at.toISOString(), ...body };
          const error = validate(merged);
          if (error) { await client.query('ROLLBACK'); res.status(400).json({ error }); return; }
          const count = await client.query('SELECT count(*)::int AS total FROM activity_participants WHERE activity_id=$1', [activity.id]);
          if (merged.capacity < count.rows[0].total) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Capacity cannot be less than the current participant count.' }); return; }
          await client.query('UPDATE activities SET title=$2,description=$3,category=$4,location=$5,starts_at=$6,ends_at=$7,capacity=$8 WHERE id=$1', [activity.id, merged.title.trim(), merged.description.trim(), merged.category, merged.location.trim(), merged.starts_at, merged.ends_at, merged.capacity]);
        }
        await client.query('COMMIT'); res.json({ ok: true });
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    });
  }
  return router;
}
