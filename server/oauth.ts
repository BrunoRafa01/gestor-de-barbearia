// Autenticacao Google OAuth 2.0 (OpenID Connect) sem dependencias externas.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';
import { HttpError } from './http.js';
import { setShopPlan } from './plans.js';
import { isSecureRequest } from './security.js';
import type { AppRequest, UserRole } from './types.js';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export const OAUTH_STATE_COOKIE = 'gb_oauth_state';

export interface GoogleOAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleUserProfile {
  email: string;
  name: string;
  picture: string | null;
}

export interface AuthorizedGoogleUser {
  id: number;
  shop_id: number;
  email: string;
  name: string;
  role: UserRole | string;
}

export type GoogleAuthorizationResult =
  | { allowed: true; user: AuthorizedGoogleUser }
  | { allowed: false; status: number; reason: string };

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
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

export function isGoogleOAuthEnabled(): boolean {
  return getGoogleOAuthConfig().enabled;
}

export function getMasterEmails(): string[] {
  const raw = String(process.env.MASTER_ALLOWED_EMAILS || '');
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedAdminEmails(): string[] {
  const raw = String(process.env.ADMIN_ALLOWED_EMAILS || '');
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveGoogleRedirectUri(req: AppRequest): string {
  const config = getGoogleOAuthConfig();
  if (config.redirectUri) return config.redirectUri;
  const proto = isSecureRequest(req) ? 'https' : 'http';
  const rawHost = String(
    req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  );
  const host = (rawHost.split(',')[0] ?? 'localhost:3000').trim();
  return `${proto}://${host}/api/auth/oauth/google/callback`;
}

export function createOAuthState(): string {
  return randomBytes(24).toString('hex');
}

export function verifyOAuthState(
  expected: string | null | undefined,
  received: string | null | undefined
): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildGoogleAuthUrl(req: AppRequest, state: string): string {
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

export async function fetchGoogleUserInfo(
  req: AppRequest,
  code: string
): Promise<GoogleUserProfile> {
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

  const tokenData = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken =
    typeof tokenData['access_token'] === 'string' ? tokenData['access_token'] : '';
  if (!tokenRes.ok || !accessToken) {
    throw new HttpError(401, 'Nao foi possivel validar o codigo de autorizacao do Google.');
  }

  const profileRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = (await profileRes.json().catch(() => ({}))) as Record<string, unknown>;
  const rawEmail = typeof profile['email'] === 'string' ? profile['email'] : '';
  if (!profileRes.ok || !rawEmail) {
    throw new HttpError(401, 'Nao foi possivel obter os dados da conta Google.');
  }
  if (profile['email_verified'] !== true) {
    throw new HttpError(403, 'O e-mail da conta Google precisa estar verificado.');
  }

  const email = rawEmail.trim().toLowerCase();
  const fallbackName = email.split('@')[0] ?? 'usuario';
  const rawName = profile['name'] || profile['given_name'] || fallbackName;

  return {
    email,
    name: String(rawName).trim(),
    picture: profile['picture'] ? String(profile['picture']) : null,
  };
}

export async function authorizeGoogleUser({
  email,
  name,
}: {
  email: string;
  name?: string | null;
}): Promise<GoogleAuthorizationResult> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return { allowed: false, status: 403, reason: 'E-mail invalido.' };
  }

  const masterEmails = getMasterEmails();
  const isMaster = masterEmails.includes(normalizedEmail);

  const existing = await get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    if (Number(existing['active']) !== 1) {
      return { allowed: false, status: 403, reason: 'Esta conta esta desativada no painel.' };
    }
    return {
      allowed: true,
      user: {
        id: Number(existing['id']),
        shop_id: Number(existing['shop_id']) || 1,
        email: String(existing['email'] ?? normalizedEmail),
        name: String(existing['name'] ?? ''),
        role: isMaster ? 'master' : String(existing['role'] || 'owner'),
      },
    };
  }

  const allowedEmails = getAllowedAdminEmails();
  const fallbackUser = normalizedEmail.split('@')[0] ?? 'Barbearia';
  const safeName = String(name || fallbackUser).slice(0, 120);

  if (isMaster || allowedEmails.includes(normalizedEmail)) {
    const role: UserRole = isMaster ? 'master' : 'owner';
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
