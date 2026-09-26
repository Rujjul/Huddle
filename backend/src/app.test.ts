import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './app.js';
test('health succeeds when database responds', async () => {
  const response = await request(createApp(async () => {})).get('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, database: 'connected' });
});
test('database failure is a 503 and does not expose credentials', async () => {
  const response = await request(createApp(async () => { throw new Error('secret connection string'); })).get('/api/health');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { ok: false, database: 'unavailable' });
  assert.equal(response.text.includes('secret'), false);
});
test('unknown API routes return JSON 404', async () => {
  const response = await request(createApp(async () => {})).get('/api/private');
  assert.equal(response.status, 404);
});
