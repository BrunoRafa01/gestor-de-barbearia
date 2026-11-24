// Autenticacao do painel administrativo.
// Sessao stateless assinada com HMAC-SHA256 em cookie HttpOnly e senha
// protegida com scrypt (derivacao lenta, com salt aleatorio por senha).

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { get, getSetting, run, setSetting } from './db.js';
import { HttpError, clearCookie, parseCookies, setCookie } from './http.js';
import { isSecureRequest } from './security.js';
import type { AppRequest, SessionPayload, UserRole } from './types.js';

export const SESSION_COOKIE = 'gb_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 horas (com renovacao deslizante)
export const SESSION_SLIDING_WINDOW_MS = 1000 * 60 * 15; // renova cookie apos 15 min de uso ativo

export type AuthSessionPayload = SessionPayload & {
  shopId: number;
};

export interface EnsureAdminPasswordOptions {
  isDefault?: boolean;
}

export interface EnsureAdminPasswordResult {
  created: boolean;
  generatedPassword: string | null;
  weakPassword: boolean;
}

export interface CreateSessionTokenOptions {
  sub?: string;
  shopId?: number;
  shop_id?: number;
  role?: UserRole | string;
  ver?: number;
  mfa?: boolean;
}

export interface StartSessionOptions extends CreateSessionTokenOptions {
  secure?: boolean;
}

/* ---------------------------- Senha (scrypt) ------------------------------ */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: unknown, stored: unknown): boolean {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = scryptSync(String(password ?? ''), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

const COMMON_WEAK_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '00000000',
  '11111111',
  '87654321',
  'admin123',
  'admin1234',
  'admin@123',
  'administrador',
  'administrador123',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty123',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm1',
  'iloveyou',
  'iloveyou1',
  'welcome1',
  'welcome123',
  'letmein1',
  'monkey123',
  'dragon123',
  'master123',
  'changeme',
  'changeme123',
  'mudar123',
  'mudar@123',
  'senha123',
  'senha1234',
  'senha@123',
  'minhasenha1',
  'barbearia',
  'barbearia1',
  'barbearia123',
  'barbeiro123',
  'navalha123',
  'brasil123',
  'sucesso123',
  'atendimento1',
  'gestor123',
]);

/**
 * Unica fonte de verdade da politica de senha em todo o sistema.
 * Retorna mensagem de erro ou null se a senha atender aos requisitos.
 */
export function passwordIssue(password: unknown): string | null {
  const value = String(password ?? '');
  if (value.length < 8) return 'A senha deve ter ao menos 8 caracteres.';
  if (value.length > 128) return 'A senha deve ter no maximo 128 caracteres.';
  if (COMMON_WEAK_PASSWORDS.has(value.toLowerCase())) {
    return 'Esta senha e muito comum e insegura. Escolha outra combinacao.';
  }
  if (!/[A-Z]/.test(value)) return 'A senha deve conter ao menos uma letra maiuscula.';
  if (!/[a-z]/.test(value)) return 'A senha deve conter ao menos uma letra minuscula.';
  if (!/\d/.test(value)) return 'A senha deve conter ao menos um numero.';
  return null;
}

export function isWeakInitialPassword(password: unknown): boolean {
  const value = String(password ?? '');
  if (!value) return true;
  return passwordIssue(value) !== null;
}

/**
 * Cria a senha inicial do painel caso ainda nao exista.
 * Sem `initialPassword`, gera uma senha provisoria aleatoria (`isDefault = true`).
 * Se `initialPassword` for fraca/comum: em producao recusa iniciar; em dev marca como provisoria.
 */
export async function ensureAdminPassword(
  initialPassword?: string | null,
  { isDefault = false }: EnsureAdminPasswordOptions = {}
): Promise<EnsureAdminPasswordResult> {
  if (!getSetting('admin_password_hash')) {
    if (initialPassword && isWeakInitialPassword(initialPassword)) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'ADMIN_PASSWORD fraca ou comum nao e permitida em producao. Use 8+ caracteres com maiuscula, minuscula e numero.'
        );
      }
      await setSetting('admin_password_hash', hashPassword(initialPassword));
      await setSetting('admin_password_default', '1');
      return { created: true, generatedPassword: null, weakPassword: true };
    }

    const generated = initialPassword ? null : `Gb1${randomBytes(8).toString('base64url')}`;
    const secret = initialPassword || generated || `Gb1${randomBytes(8).toString('base64url')}`;
    await setSetting('admin_password_hash', hashPassword(secret));
    await setSetting('admin_password_default', isDefault || !initialPassword ? '1' : '0');
    return { created: true, generatedPassword: generated, weakPassword: false };
  }
  return { created: false, generatedPassword: null, weakPassword: false };
}

/** Indica se o painel ainda usa a senha inicial (nunca trocada). */
export function isUsingDefaultPassword(): boolean {
  return String(getSetting('admin_password_default', '0')) === '1';
}

/* ------------------------------- Sessao ----------------------------------- */

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken({
  sub = 'admin',
  shopId,
  shop_id,
  role = 'owner',
  ver,
  mfa = false,
}: CreateSessionTokenOptions = {}): string {
  const secret = process.env.SESSION_SECRET || getSetting('session_secret');
  if (!secret) {
    throw new Error('Segredo de sessao nao inicializado.');
  }
  const resolvedShopId = Number(shopId ?? shop_id) || 1;
  const resolvedVer =
    ver !== undefined
      ? Number(ver) || 1
      : sub === 'admin'
        ? Number(getSetting('session_version', '1')) || 1
        : 1;
  const now = Date.now();
  const payload = base64url(
    JSON.stringify({
      sub,
      shopId: resolvedShopId,
      shop_id: resolvedShopId,
      role,
      ver: resolvedVer,
      mfa: Boolean(mfa),
      iat: now,
      exp: now + SESSION_TTL_MS,
    })
  );
  return `${payload}.${sign(payload, secret)}`;
}

export async function rotateSessionSecret(): Promise<string> {
  const secret = randomBytes(32).toString('hex');
  await setSetting('session_secret', secret);
  const nextVer = (Number(getSetting('session_version', '1')) || 1) + 1;
  await setSetting('session_version', String(nextVer));
  return secret;
}

export async function revokeAllSessions(): Promise<number> {
  const nextVer = (Number(getSetting('session_version', '1')) || 1) + 1;
  await setSetting('session_version', String(nextVer));
  return nextVer;
}

/** Incrementa session_version da conta informada ('admin' ou email na tabela users). */
export async function revokeUserSessions(sub?: string | null): Promise<number> {
  const normalized = String(sub || 'admin').trim();
  if (!normalized || normalized === 'admin') {
    return revokeAllSessions();
  }
  await run(
    'UPDATE users SET session_version = COALESCE(session_version, 1) + 1 WHERE email = ?',
    [normalized]
  );
  const row = await get('SELECT session_version FROM users WHERE email = ?', [normalized]);
  return Number(row?.['session_version']) || 1;
}

export function parseSessionToken(token: string | null | undefined): AuthSessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const secret = process.env.SESSION_SECRET || getSetting('session_secret');
  if (!secret) return null;

  const expected = sign(payload, secret);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const sub = typeof data['sub'] === 'string' && data['sub'] ? data['sub'] : 'admin';
    if (sub === 'admin') {
      const currentVer = Number(getSetting('session_version', '1')) || 1;
      if (data['ver'] !== undefined && Number(data['ver']) !== currentVer) return null;
    }
    const exp = data['exp'];
    if (typeof exp !== 'number' || exp <= Date.now()) return null;
    const resolvedShopId = Number(data['shopId'] ?? data['shop_id']) || 1;
    return {
      sub,
      shop_id: resolvedShopId,
      shopId: resolvedShopId,
      role: typeof data['role'] === 'string' && data['role'] ? data['role'] : 'owner',
      ver: Number(data['ver']) || 1,
      mfa: Boolean(data['mfa']),
      iat: typeof data['iat'] === 'number' ? data['iat'] : exp - SESSION_TTL_MS,
      exp,
    };
  } catch {
    return null;
  }
}

export function verifySessionToken(token: string | null | undefined): boolean {
  return parseSessionToken(token) !== null;
}

export function getSessionPayload(req: AppRequest): AuthSessionPayload | null {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEMO_MODE === '1' &&
    process.env.DEMO_AUTO_AUTH === '1'
  ) {
    const now = Date.now();
    return {
      sub: 'demo',
      shop_id: 1,
      shopId: 1,
      role: 'owner',
      ver: 1,
      iat: now,
      exp: now + SESSION_TTL_MS,
    };
  }
  const cookies = parseCookies(req);
  return parseSessionToken(cookies[SESSION_COOKIE]);
}

/** Cria a sessao. `secure` marca o cookie como exclusivo de HTTPS. */
export function startSession(
  res: ServerResponse,
  {
    secure = false,
    sub = 'admin',
    shopId,
    shop_id,
    role = 'owner',
    ver,
    mfa = false,
  }: StartSessionOptions = {}
): string {
  const resolvedShopId = Number(shopId ?? shop_id) || 1;
  const token = createSessionToken({
    sub,
    shopId: resolvedShopId,
    shop_id: resolvedShopId,
    role,
    ver,
    mfa,
  });
  setCookie(res, SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_MS,
    secure,
    sameSite: 'Lax',
    httpOnly: true,
  });
  return token;
}

/**
 * Valida a sessao contra o banco (incluindo session_version de usuarios multi-tenant)
 * e aplica renovacao deslizante do cookie quando necessario.
 */
export async function validateActiveSession(
  req: AppRequest,
  res?: ServerResponse | null
): Promise<AuthSessionPayload | null> {
  const session = getSessionPayload(req);
  if (!session) return null;

  if (
    session.sub !== 'admin' &&
    session.sub !== 'demo' &&
    session.sub !== 'demo@novaruntime.local'
  ) {
    const user = await get(
      'SELECT session_version, active, role FROM users WHERE email = ?',
      [session.sub]
    );
    if (!user || Number(user['active']) !== 1) return null;
    const dbVer = Number(user['session_version'] ?? 1) || 1;
    if (session.ver !== dbVer) return null;
    session.role = String(user['role'] || session.role);
  }

  // Renovacao deslizante se ja passou da janela minima desde a emissao
  if (res && !res.headersSent && Date.now() - session.iat >= SESSION_SLIDING_WINDOW_MS) {
    startSession(res, {
      secure: isSecureRequest(req),
      sub: session.sub,
      shopId: session.shopId,
      role: session.role,
      ver: session.ver,
      mfa: session.mfa,
    });
  }

  return session;
}

export async function assertActiveSession(
  req: AppRequest,
  res?: ServerResponse | null
): Promise<AuthSessionPayload> {
  const session = await validateActiveSession(req, res);
  if (!session) {
    throw new HttpError(401, 'Sessao expirada ou revogada. Faca login novamente.');
  }
  return session;
}

export function endSession(
  res: ServerResponse,
  { secure = false }: { secure?: boolean } = {}
): void {
  clearCookie(res, SESSION_COOKIE, { secure });
}

export function isAuthenticated(req: AppRequest): boolean {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEMO_MODE === '1' &&
    process.env.DEMO_AUTO_AUTH === '1'
  ) {
    return true;
  }
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

export function assertAuthenticated(req: AppRequest): void {
  if (!isAuthenticated(req)) {
    throw new HttpError(401, 'Sessao expirada. Faca login novamente.');
  }
}
