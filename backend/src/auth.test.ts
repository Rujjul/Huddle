import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { eligible, requireAuth } from './auth.js';
import type { TokenPayload } from 'google-auth-library';
const payload = { sub: '123', email: 'student@vitbhopal.ac.in', email_verified: true, hd: 'vitbhopal.ac.in' } as TokenPayload;
test('campus eligibility requires verified email and exact hosted domain', () => {
  assert.equal(eligible(payload, 'vitbhopal.ac.in'), true);
  for (const change of [{ email_verified: false }, { email: 'student@gmail.com' }, { hd: undefined }, { hd: 'other.ac.in' }, { email: 'student@fakevitbhopal.ac.in' }, { email: 'student@vitbhopal.ac.in.evil.com' }, { sub: '' }]) {
    assert.equal(eligible({ ...payload, ...change }, 'vitbhopal.ac.in'), false);
  }
});
test('protected route rejects missing identity', async () => {
  const app = express();
  app.use((req, _res, next) => { req.session = {} as typeof req.session; next(); });
  app.get('/private', requireAuth, (_req, res) => res.json({ ok: true }));
  assert.equal((await request(app).get('/private')).status, 401);
});
