import { createApp } from './app.js';
import { pool } from './db.js';
import { config } from './config.js';
import { createAuth } from './auth.js';
import { createServer } from 'node:http';
import { attachChat } from './chat.js';
const auth = createAuth(pool, config);
const server = createServer(createApp(() => pool.query('SELECT 1'), auth));
const io = attachChat(server, auth.sessionMiddleware, pool, new URL(config.appOrigin).origin);
server.listen(config.port, () => console.log(`Huddle API: http://localhost:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  io.close(() => { void pool.end().then(() => process.exit(0)); });
});
