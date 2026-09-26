import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env.');
export const config = {
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:5173',
  campusDomain: process.env.CAMPUS_EMAIL_DOMAIN || 'vitbhopal.ac.in',
  sessionSecret: process.env.SESSION_SECRET || '',
};
