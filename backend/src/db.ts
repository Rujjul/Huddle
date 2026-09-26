import pg from 'pg';
import { config } from './config.js';
export const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000, query_timeout: 3000, max: 10 });
pool.on('error', () => console.error('Database connection interrupted.'));
