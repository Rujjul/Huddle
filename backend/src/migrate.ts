import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pool } from './db.js';
const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
try {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(842193)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = await readFile(`${directory}/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) throw new Error('Applied migration changed');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    console.log('Database migrations are up to date.');
  } finally { await client.query('SELECT pg_advisory_unlock(842193)'); client.release(); }
} catch { console.error('Migration failed. Check database availability and migration files.'); process.exitCode = 1; }
finally { await pool.end(); }
