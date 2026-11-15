// Autenticacao Google OAuth 2.0 (OpenID Connect) sem dependencias externas.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';
import { HttpError } from './http.js';
import { setShopPlan } from './plans.js';
import { isSecureRequest } from './security.js';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export const OAUTH_STATE_COOKIE = 'gb_oauth_state';

export function getGoogleOAuthConfig() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  return {
    enabled: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function isGoogleOAuthEnabled() {
  return getGoogleOAuthConfig().enabled;
}

export function getMasterEmails() {
  const raw = String(process.env.MASTER_ALLOWED_EMAILS || '');
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedAdminEmails() {
  const raw = String(process.env.ADMIN_ALLOWED_EMAILS || '');
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveGoogleRedirectUri(req) {
  const config = getGoogleOAuthConfig();
  if (config.redirectUri) return config.redirectUri;
  const proto = isSecureRequest(req) ? 'https' : 'http';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
  const host = rawHost.split(',')[0].trim();
  return `${proto}://${host}/api/auth/oauth/google/callback`;
}

export function createOAuthState() {
  return randomBytes(24).toString('hex');
}

export function verifyOAuthState(expected, received) {
  if (!expected || !received) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildGoogleAuthUrl(req, state) {
  const config = getGoogleOAuthConfig();
  if (!config.enabled) {
    throw new HttpError(503, 'Login com Google nao configurado neste servidor.');
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: resolveGoogleRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function fetchGoogleUserInfo(req, code) {
  const config = getGoogleOAuthConfig();
  if (!config.enabled) {
    throw new HttpError(503, 'Login com Google nao configurado neste servidor.');
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: resolveGoogleRedirectUri(req),
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new HttpError(401, 'Nao foi possivel validar o codigo de autorizacao do Google.');
  }

  const profileRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok || !profile.email) {
    throw new HttpError(401, 'Nao foi possivel obter os dados da conta Google.');
  }
  if (profile.email_verified !== true) {
    throw new HttpError(403, 'O e-mail da conta Google precisa estar verificado.');
  }

  return {
    email: String(profile.email).trim().toLowerCase(),
    name: String(profile.name || profile.given_name || profile.email.split('@')[0]).trim(),
    picture: profile.picture ? String(profile.picture) : null,
  };
}

export async function authorizeGoogleUser({ email, name }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return { allowed: false, status: 403, reason: 'E-mail invalido.' };
  }

  const masterEmails = getMasterEmails();
  const isMaster = masterEmails.includes(normalizedEmail);

  const existing = await get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    if (Number(existing.active) !== 1) {
      return { allowed: false, status: 403, reason: 'Esta conta esta desativada no painel.' };
    }
    return {
      allowed: true,
      user: {
        id: existing.id,
        shop_id: Number(existing.shop_id) || 1,
        email: existing.email,
        name: existing.name,
        role: isMaster ? 'master' : existing.role || 'owner',
      },
    };
  }

  const allowedEmails = getAllowedAdminEmails();
  const safeName = String(name || normalizedEmail.split('@')[0]).slice(0, 120);

  if (isMaster || allowedEmails.includes(normalizedEmail)) {
    const role = isMaster ? 'master' : 'owner';
    const info = await run(
      'INSERT INTO users (shop_id, email, name, password_hash, role, active) VALUES (?, ?, ?, ?, ?, 1)',
      [1, normalizedEmail, safeName, '!oauth-only', role]
    );
    return {
      allowed: true,
      user: {
        id: Number(info.lastInsertRowid),
        shop_id: 1,
        email: normalizedEmail,
        name: safeName,
        role,
      },
    };
  }

  const allowSignup = /^(1|true|yes)$/i.test(String(process.env.OAUTH_ALLOW_SIGNUP || '').trim());
  if (!allowSignup) {
    return {
      allowed: false,
      status: 403,
      reason: 'E-mail nao autorizado. Solicite liberacao ao administrador.',
    };
  }

  const shopName = `Barbearia ${safeName}`.slice(0, 120);
  const baseSlug =
    shopName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'barbearia';
  const slug = `${baseSlug}-${randomBytes(3).toString('hex')}`;

  const shopInfo = await run(
    'INSERT INTO barbershops (slug, name, company, active) VALUES (?, ?, ?, 1)',
    [slug, shopName, shopName]
  );
  const shopId = Number(shopInfo.lastInsertRowid);
  const userInfo = await run(
    'INSERT INTO users (shop_id, email, name, password_hash, role, active) VALUES (?, ?, ?, ?, ?, 1)',
    [shopId, normalizedEmail, safeName, '!oauth-only', 'owner']
  );
  await setShopPlan(shopId, 'free', { provider: 'oauth-google' });

  return {
    allowed: true,
    user: {
      id: Number(userInfo.lastInsertRowid),
      shop_id: shopId,
      email: normalizedEmail,
      name: safeName,
      role: 'owner',
    },
  };
}
