// Autenticacao do painel administrativo.
// Sessao stateless assinada com HMAC-SHA256 em cookie HttpOnly e senha
// protegida com scrypt (derivacao lenta, com salt aleatorio por senha).

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { HttpError, clearCookie, parseCookies, setCookie } from './http.js';

export const SESSION_COOKIE = 'gb_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

/* ---------------------------- Senha (scrypt) ------------------------------ */

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Politica minima de senha para o painel.
 * @returns {string|null} mensagem de erro ou null se a senha for aceitavel.
 */
export function passwordIssue(password) {
  const value = String(password ?? '');
  if (value.length < 8) return 'A senha deve ter ao menos 8 caracteres.';
  if (value.length > 128) return 'A senha deve ter no maximo 128 caracteres.';
  if (!/[A-Za-z]/.test(value)) return 'A senha deve conter ao menos uma letra.';
  if (!/\d/.test(value)) return 'A senha deve conter ao menos um numero.';
  return null;
}

/**
 * Cria a senha inicial do painel caso ainda nao exista.
 * `isDefault` marca a senha como provisoria (so quando nenhum ADMIN_PASSWORD foi
 * informado), o que faz o painel avisar que ela precisa ser trocada.
 * @returns {Promise<boolean>} true se a senha acabou de ser criada.
 */
export async function ensureAdminPassword(initialPassword, { isDefault = false } = {}) {
  if (!getSetting('admin_password_hash')) {
    await setSetting('admin_password_hash', hashPassword(initialPassword || 'admin123'));
    await setSetting('admin_password_default', isDefault ? '1' : '0');
    return true;
  }
  return false;
}

/** Indica se o painel ainda usa a senha inicial (nunca trocada). */
export function isUsingDefaultPassword() {
  return String(getSetting('admin_password_default', '0')) === '1';
}

/* ------------------------------- Sessao ----------------------------------- */

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken() {
  const secret = process.env.SESSION_SECRET || getSetting('session_secret');
  const payload = base64url(
    JSON.stringify({ sub: 'admin', iat: Date.now(), exp: Date.now() + SESSION_TTL_MS })
  );
  return `${payload}.${sign(payload, secret)}`;
}

export async function rotateSessionSecret() {
  const secret = randomBytes(32).toString('hex');
  await setSetting('session_secret', secret);
  return secret;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const secret = process.env.SESSION_SECRET || getSetting('session_secret');
  if (!secret) return false;

  const expected = sign(payload, secret);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

/** Cria a sessao. `secure` marca o cookie como exclusivo de HTTPS. */
export function startSession(res, { secure = false } = {}) {
  const token = createSessionToken();
  setCookie(res, SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_MS,
    secure,
    sameSite: 'Lax',
    httpOnly: true,
  });
  return token;
}

export function endSession(res, { secure = false } = {}) {
  clearCookie(res, SESSION_COOKIE, { secure });
}

export function isAuthenticated(req) {
  if (process.env.DEMO_AUTO_AUTH === '1') return true;
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

export function assertAuthenticated(req) {
  if (!isAuthenticated(req)) {
    throw new HttpError(401, 'Sessao expirada. Faca login novamente.');
  }
}
