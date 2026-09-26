import express, { type Router, type ErrorRequestHandler } from 'express';
import { fileURLToPath } from 'node:url';
type DatabaseCheck = () => Promise<unknown>;
export function createApp(checkDatabase: DatabaseCheck, auth?: Router) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await checkDatabase();
      res.json({ ok: true, database: 'connected' });
    } catch {
      res.status(503).json({ ok: false, database: 'unavailable' });
    }
  });
  if (auth) {
    app.get('/auth/google/callback', (req, res) => {
      const query = new URLSearchParams();
      for (const key of ['code', 'state', 'error']) if (typeof req.query[key] === 'string') query.set(key, req.query[key]);
      res.redirect(`/api/auth/google/callback?${query.toString()}`);
    });
    app.use('/api', auth);
  }
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Endpoint not found' }); });
  if (process.env.NODE_ENV === 'production') {
    const frontend = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
    app.use(express.static(frontend));
    app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: frontend }));
  }
  const errorHandler: ErrorRequestHandler = (_error, _req, res, _next) => {
    console.error('Request failed.');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
  app.use(errorHandler);
  return app;
}
