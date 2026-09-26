import { Router } from 'express';
import type pg from 'pg';
import { requireAuth } from './auth.js';

export const interests = ['Badminton', 'Basketball', 'Books', 'Coding', 'Coffee', 'Cricket', 'Dance', 'Fitness', 'Football', 'Gaming', 'Movies', 'Music', 'Photography', 'Running', 'Study groups', 'Travel'];
const fields = `id, display_name, bio, profile_completed_at,
  COALESCE((SELECT json_agg(interest ORDER BY interest) FROM user_interests WHERE user_id = users.id), '[]'::json) AS interests`;
export function createProfiles(pool: pg.Pool, origin: string) {
  const router = Router();
  router.use(requireAuth);
  router.get('/interests', (_req, res) => res.json({ interests }));
  router.get('/me/profile', async (req, res) => {
    const result = await pool.query(`SELECT ${fields} FROM users WHERE id = $1`, [req.session.userId]);
    if (!result.rowCount) { res.status(401).json({ error: 'Please sign in again.' }); return; }
    res.json({ profile: result.rows[0] });
  });
  router.patch('/me/profile', async (req, res) => {
    if (req.get('origin') !== origin || !req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) { res.status(403).json({ error: 'Refresh the page and try again.' }); return; }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['display_name', 'bio', 'interests'].includes(key)) || !Object.keys(body).length) { res.status(400).json({ error: 'Provide only profile fields: display_name, bio, interests.' }); return; }
    if (body.display_name !== undefined && (typeof body.display_name !== 'string' || !body.display_name.trim() || body.display_name.trim().length > 80)) { res.status(400).json({ error: 'Name must contain 1–80 characters.' }); return; }
    if (body.bio !== undefined && (typeof body.bio !== 'string' || body.bio.trim().length > 500)) { res.status(400).json({ error: 'Bio must be at most 500 characters.' }); return; }
    if (body.interests !== undefined && (!Array.isArray(body.interests) || body.interests.length > 8 || body.interests.some((item: unknown) => typeof item !== 'string' || !interests.includes(item)) || new Set(body.interests).size !== body.interests.length)) { res.status(400).json({ error: 'Choose up to 8 different interests from the list.' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('UPDATE users SET display_name = COALESCE($2, display_name), bio = COALESCE($3, bio), profile_completed_at = COALESCE(profile_completed_at, now()) WHERE id = $1 RETURNING id', [req.session.userId, body.display_name?.trim(), body.bio?.trim()]);
      if (!result.rowCount) { await client.query('ROLLBACK'); res.status(401).json({ error: 'Please sign in again.' }); return; }
      if (body.interests !== undefined) {
        await client.query('DELETE FROM user_interests WHERE user_id = $1', [req.session.userId]);
        await client.query('INSERT INTO user_interests (user_id, interest) SELECT $1, unnest($2::text[])', [req.session.userId, body.interests]);
      }
      const profile = await client.query(`SELECT ${fields} FROM users WHERE id = $1`, [req.session.userId]);
      await client.query('COMMIT');
      res.json({ profile: profile.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  router.get('/users/:id', async (req, res) => {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(req.params.id))) { res.status(400).json({ error: 'Invalid profile ID.' }); return; }
    const result = await pool.query(`SELECT ${fields} FROM users WHERE id = $1 AND profile_completed_at IS NOT NULL`, [req.params.id]);
    if (!result.rowCount) { res.status(404).json({ error: 'This profile is not available yet.' }); return; }
    const { profile_completed_at: _completed, ...profile } = result.rows[0];
    res.json({ profile });
  });
  return router;
}
