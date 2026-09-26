import { Router, type RequestHandler } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { OAuth2Client, CodeChallengeMethod, type TokenPayload } from 'google-auth-library';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { createProfiles } from './profiles.js';
import { createActivities } from './activities.js';
import { createChat } from './chat.js';
import { createAttachments } from './attachments.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrf?: string;
    oauth?: { state: string; nonce: string; verifier: string; created: number };
  }
}
export type AuthConfig = { production: boolean; clientId: string; clientSecret: string; callbackUrl: string; appOrigin: string; campusDomain: string; sessionSecret: string };
export function eligible(payload: TokenPayload | undefined, domain: string): payload is TokenPayload & { email: string } {
  return Boolean(payload?.sub && payload.email_verified === true && payload.email?.split('@').length === 2 && payload.email.split('@')[1].toLowerCase() === domain.toLowerCase() && payload.hd?.toLowerCase() === domain.toLowerCase());
}
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) { res.status(401).json({ error: 'Sign in with your campus account to continue.' }); return; }
  next();
};
export function createAuth(pool: pg.Pool, config: AuthConfig, oauthClient?: Pick<OAuth2Client, 'generateCodeVerifierAsync' | 'generateAuthUrl' | 'getToken' | 'verifyIdToken'>) {
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const origin = new URL(config.appOrigin).origin;
  if (new URL(config.callbackUrl).hostname !== new URL(origin).hostname) throw new Error('APP_ORIGIN and GOOGLE_CALLBACK_URL must use the same hostname.');
  if (config.production && (new URL(origin).protocol !== 'https:' || new URL(config.callbackUrl).protocol !== 'https:')) throw new Error('Production authentication requires HTTPS.');
  const client = oauthClient || new OAuth2Client(config.clientId, config.clientSecret, config.callbackUrl);
  const PgStore = connectPgSimple(session);
  const router = Router();
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
  const sessionMiddleware = session({ name: 'huddle.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false,
    store: new PgStore({ pool, tableName: 'sessions', errorLog: () => console.error('Session storage error.') }),
    cookie: { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 },
  });
  router.use(sessionMiddleware);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please try again later.' } }));
  router.get('/auth/google', async (req, res, next) => {
    // localhost and 127.0.0.1 do not share cookies. Begin on the callback hostname.
    if (!config.production && req.hostname !== new URL(origin).hostname) { res.redirect(`${origin}/api/auth/google`); return; }
    if (!config.clientId || !config.clientSecret) { res.redirect(`${origin}/?authError=configuration`); return; }
    try {
      const codes = await client.generateCodeVerifierAsync();
      req.session.oauth = { state: randomBytes(32).toString('hex'), nonce: randomBytes(32).toString('hex'), verifier: codes.codeVerifier, created: Date.now() };
      const url = client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state: req.session.oauth.state,
        nonce: req.session.oauth.nonce, hd: config.campusDomain, prompt: 'select_account',
        code_challenge: codes.codeChallenge, code_challenge_method: CodeChallengeMethod.S256 });
      req.session.save(error => error ? next(error) : res.redirect(url));
    } catch (error) { next(error); }
  });
  router.get('/auth/google/callback', async (req, res) => {
    const attempt = req.session.oauth;
    delete req.session.oauth;
    const fail = (reason: string) => res.redirect(`${origin}/?authError=${reason}`);
    try {
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      if (!attempt || typeof req.query.state !== 'string' || req.query.state !== attempt.state || Date.now() - attempt.created > 10 * 60 * 1000) { fail('state'); return; }
      if (req.query.error) { fail('denied'); return; }
      if (typeof req.query.code !== 'string') { fail('failed'); return; }
      const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: attempt.verifier, redirect_uri: config.callbackUrl });
      if (!tokens.id_token) { fail('failed'); return; }
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
      const payload = ticket.getPayload();
      if ((payload as (TokenPayload & { nonce?: string }) | undefined)?.nonce !== attempt.nonce) { fail('state'); return; }
      if (!eligible(payload, config.campusDomain)) { fail('campus'); return; }
      const user = await pool.query('INSERT INTO users (google_id, email, display_name) VALUES ($1, $2, $3) ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email RETURNING id', [payload.sub, payload.email.toLowerCase(), (payload.name || 'Student').slice(0, 80)]);
      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.userId = user.rows[0].id;
      req.session.csrf = randomBytes(32).toString('hex');
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      res.redirect(`${origin}/`);
    } catch { console.error('Campus sign-in failed.'); fail('failed'); }
  });
  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const result = await pool.query('SELECT id, display_name, email FROM users WHERE id = $1', [req.session.userId]);
      if (!result.rowCount) { req.session.destroy(() => {}); res.status(401).json({ error: 'Please sign in again.' }); return; }
      res.json({ user: result.rows[0], csrfToken: req.session.csrf });
    } catch (error) { next(error); }
  });
  router.post('/logout', requireAuth, (req, res, next) => {
    if (req.get('origin') !== origin || !req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) { res.status(403).json({ error: 'Invalid request. Refresh and try again.' }); return; }
    req.session.destroy(error => {
      if (error) { next(error); return; }
      res.clearCookie('huddle.sid', cookieOptions).status(204).end();
    });
  });
  router.use(createAttachments(pool, origin));
  router.use(createChat(pool, origin));
  router.use(createActivities(pool, origin));
  router.use(createProfiles(pool, origin));
  return Object.assign(router, { sessionMiddleware });
}
