// Seguranca HTTP: cabecalhos de protecao, limite de tentativas (rate limit)
// e utilitarios de IP/origem. Tudo em memoria - suficiente para uma instancia
// unica no plano gratuito do Render.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import type { AppRequest } from './types.js';

/* --------------------------- Cabecalhos de resposta ------------------------ */

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
};

export interface SecurityHeadersOptions {
  secure?: boolean;
  requestId?: string | null;
}

/**
 * Aplica os cabecalhos de seguranca. `secure` liga o HSTS (apenas quando a
 * conexao e HTTPS, o que no Render acontece atraves do proxy TLS).
 */
export function applySecurityHeaders(
  res: ServerResponse,
  { secure = false, requestId = null }: SecurityHeadersOptions = {}
): void {
  for (const [key, value] of Object.entries(BASE_HEADERS)) {
    res.setHeader(key, value);
  }
  if (secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (requestId) res.setHeader('X-Request-Id', requestId);
}

/** 127.0.0.1 / IP real por tras de proxy confiavel (usa o IP adicionado pelo proxy). */
export function clientIp(req: AppRequest): string {
  const trustProxy = process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      const parts = forwarded
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return last;
    }
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

/** Detecta HTTPS considerando o proxy reverso (Render) e o modo producao. */
export function isSecureRequest(req: AppRequest, trustProxy: boolean = true): boolean {
  const tlsSocket = req.socket as TLSSocket | undefined;
  if (tlsSocket?.encrypted) return true;
  if (trustProxy) {
    const proto = req.headers['x-forwarded-proto'];
    if (typeof proto === 'string' && (proto.split(',')[0] ?? '').trim() === 'https') return true;
  }
  return process.env.NODE_ENV === 'production';
}

export function newRequestId(): string {
  return randomUUID().slice(0, 8);
}

/* ------------------------------- Rate limiting ----------------------------- */

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  message?: string;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  reset(key: string): void;
  size(): number;
}

interface HitEntry {
  count: number;
  resetAt: number;
}

/** Limitador com janela deslizante simples. */
export function createRateLimiter({ windowMs, max, message }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, HitEntry>();

  function prune(now: number): void {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      if (hits.size > 5000) prune(now);
      if (hits.size >= 5000) {
        const oldestKey = hits.keys().next().value;
        if (oldestKey !== undefined) hits.delete(oldestKey);
      }

      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;

      const allowed = entry.count <= max;
      return {
        allowed,
        remaining: Math.max(0, max - entry.count),
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        message,
      };
    },

    reset(key: string): void {
      hits.delete(key);
    },

    size(): number {
      return hits.size;
    },
  };
}

/** Login: 8 tentativas por 15 minutos por IP. */
export const loginLimiter: RateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
});

/** Agendamento publico: 40 criacoes por 30 minutos por IP (anti-spam). */
export const publicBookingLimiter: RateLimiter = createRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 40,
  message: 'Muitos agendamentos enviados deste dispositivo. Tente novamente mais tarde.',
});

/** Leitura publica (slots/calendario): 300 consultas por 10 minutos por IP. */
export const publicReadLimiter: RateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 300,
  message: 'Muitas consultas seguidas. Aguarde alguns instantes.',
});

/** DSR / LGPD: 10 solicitacoes por hora por IP. */
export const dsrLimiter: RateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Limite de solicitacoes LGPD atingido. Tente novamente mais tarde.',
});

/* -------------------- Anonimizacao de IP & Protecao LGPD ------------------- */

/** Anonimiza enderecos IP para logs e auditoria em conformidade com a LGPD. */
export function anonymizeIp(ip: string | null | undefined): string {
  if (!ip || typeof ip !== 'string') return '0.0.0.0';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0] ?? '0'}.${parts[1] ?? '0'}.***.***`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}:****:****:****`;
  }
  return '***.***.***.***';
}

/* ----------------------- Criptografia de Dados em Repouso ------------------ */

const EPHEMERAL_DEV_KEY = randomBytes(32);

function getEncryptionKey(): Buffer {
  if (process.env.DATA_ENCRYPTION_KEY && /^[0-9a-f]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY)) {
    return Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATA_ENCRYPTION_KEY nao configurada em producao.');
  }
  return EPHEMERAL_DEV_KEY;
}

function getPreviousEncryptionKey(): Buffer | null {
  const prev = process.env.DATA_ENCRYPTION_PREVIOUS_KEY;
  if (prev && /^[0-9a-f]{64}$/i.test(prev)) {
    return Buffer.from(prev, 'hex');
  }
  return null;
}

export function isEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('enc:');
}

/** Criptografa dados sensiveis (PII) usando AES-256-GCM. */
export function encryptSensitiveField(plaintext: string): string;
export function encryptSensitiveField<T>(plaintext: T): T;
export function encryptSensitiveField(plaintext: unknown): unknown {
  if (typeof plaintext !== 'string') return plaintext;
  if (isEncryptedField(plaintext)) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptWithKey(iv: Buffer, tag: Buffer, encryptedText: string, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Descriptografa dados usando AES-256-GCM (com fallback para DATA_ENCRYPTION_PREVIOUS_KEY em rotacao). */
export function decryptSensitiveField(ciphertext: string): string;
export function decryptSensitiveField<T>(ciphertext: T): T;
export function decryptSensitiveField(ciphertext: unknown): unknown {
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith('enc:')) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length !== 4) return ciphertext;
  const ivHex = parts[1];
  const tagHex = parts[2];
  const encryptedText = parts[3];
  if (!ivHex || !tagHex || encryptedText === undefined) return ciphertext;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  try {
    return decryptWithKey(iv, tag, encryptedText, getEncryptionKey());
  } catch {
    const prevKey = getPreviousEncryptionKey();
    if (prevKey) {
      try {
        return decryptWithKey(iv, tag, encryptedText, prevKey);
      } catch {
        return ciphertext;
      }
    }
    return ciphertext;
  }
}

/** Gera hash cego deterministico (HMAC-SHA256) do telefone normalizado para buscas exatas sem expor PII. */
export function blindIndex(value: string | null | undefined): string {
  const normalized = String(value ?? '').replace(/\D/g, '').trim();
  if (!normalized) return '';
  return createHmac('sha256', getEncryptionKey()).update(`phone:${normalized}`).digest('hex');
}

/** Descriptografa campos pessoais de cliente (direto ou prefixado com client_ em JOINs). */
export function decryptClientFields<T extends Record<string, unknown>>(row: T): T {
  const next: Record<string, unknown> = { ...row };
  for (const field of ['name', 'phone', 'email', 'client_name', 'client_phone', 'client_email']) {
    if (typeof next[field] === 'string') {
      next[field] = decryptSensitiveField(next[field] as string);
    }
  }
  return next as T;
}

/* ---------------- Bloqueio Progressivo de Login por Conta ---------------- */

export interface AccountLockoutStatus {
  allowed: boolean;
  failures: number;
  retryAfterSeconds: number;
  message?: string;
}

interface AccountAttemptRecord {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

const ACCOUNT_ATTEMPTS = new Map<string, AccountAttemptRecord>();
const ACCOUNT_STALE_MS = 60 * 60 * 1000; // 1 hora sem falhas zera historico

function normalizeAccountKey(account?: string | null): string {
  const trimmed = String(account || '').trim().toLowerCase();
  return trimmed || '__local_admin__';
}

function lockoutDurationMsForFailures(failures: number): number {
  if (failures >= 10) return 15 * 60 * 1000; // 15 min
  if (failures >= 8) return 5 * 60 * 1000;   // 5 min
  if (failures >= 5) return 60 * 1000;       // 1 min
  return 0;
}

export function checkAccountLockout(account?: string | null, now = Date.now()): AccountLockoutStatus {
  const key = normalizeAccountKey(account);
  const record = ACCOUNT_ATTEMPTS.get(key);
  if (!record) return { allowed: true, failures: 0, retryAfterSeconds: 0 };

  if (now - record.lastFailureAt > ACCOUNT_STALE_MS && record.lockedUntil <= now) {
    ACCOUNT_ATTEMPTS.delete(key);
    return { allowed: true, failures: 0, retryAfterSeconds: 0 };
  }

  if (record.lockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.lockedUntil - now) / 1000));
    return {
      allowed: false,
      failures: record.failures,
      retryAfterSeconds,
      message: `Conta temporariamente bloqueada por excesso de tentativas. Aguarde ${retryAfterSeconds}s.`,
    };
  }

  return { allowed: true, failures: record.failures, retryAfterSeconds: 0 };
}

export function recordAccountLoginFailure(account?: string | null, now = Date.now()): AccountLockoutStatus {
  const key = normalizeAccountKey(account);
  const prev = ACCOUNT_ATTEMPTS.get(key);
  const failures = prev && now - prev.lastFailureAt <= ACCOUNT_STALE_MS ? prev.failures + 1 : 1;
  const lockMs = lockoutDurationMsForFailures(failures);
  const lockedUntil = lockMs > 0 ? now + lockMs : 0;

  ACCOUNT_ATTEMPTS.set(key, {
    failures,
    lockedUntil,
    lastFailureAt: now,
  });

  if (lockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil(lockMs / 1000));
    return {
      allowed: false,
      failures,
      retryAfterSeconds,
      message: `Conta temporariamente bloqueada por excesso de tentativas. Aguarde ${retryAfterSeconds}s.`,
    };
  }

  return { allowed: true, failures, retryAfterSeconds: 0 };
}

export function resetAccountLockout(account?: string | null): void {
  ACCOUNT_ATTEMPTS.delete(normalizeAccountKey(account));
}

/* ---------------------- Logger de Eventos SecOps ------------------------- */

export interface SecurityLogEntry {
  id: string;
  timestamp: string;
  type: string;
  ip_anonymized: string;
  userAgent: string;
  details: Record<string, unknown>;
}

export interface SecurityLogStoreAdapter {
  insert: (entry: SecurityLogEntry) => Promise<void>;
  list: (limit: number) => Promise<SecurityLogEntry[]>;
}

const FALLBACK_SECURITY_LOGS: SecurityLogEntry[] = [];
const MAX_FALLBACK_ENTRIES = 200;
let logStoreAdapter: SecurityLogStoreAdapter | null = null;

export function registerSecurityLogStore(adapter: SecurityLogStoreAdapter | null): void {
  logStoreAdapter = adapter;
}

export function logSecurityEvent(
  type: string,
  details: Record<string, unknown> = {},
  req: AppRequest | null = null
): SecurityLogEntry {
  const ip = req ? clientIp(req) : 'sistema';
  const rawUa = req?.headers['user-agent'];
  const uaStr = typeof rawUa === 'string' ? rawUa : Array.isArray(rawUa) ? (rawUa[0] ?? '') : '';
  const entry: SecurityLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    ip_anonymized: anonymizeIp(ip),
    userAgent: uaStr ? uaStr.slice(0, 120) : 'n/a',
    details,
  };
  FALLBACK_SECURITY_LOGS.push(entry);
  if (FALLBACK_SECURITY_LOGS.length > MAX_FALLBACK_ENTRIES) {
    FALLBACK_SECURITY_LOGS.shift();
  }
  if (logStoreAdapter) {
    void logStoreAdapter.insert(entry).catch(() => {
      /* mantem no buffer em memoria se o banco estiver fechado */
    });
  }
  return entry;
}

export async function getSecurityLogs(limit: number = 50): Promise<SecurityLogEntry[]> {
  if (logStoreAdapter) {
    try {
      return await logStoreAdapter.list(limit);
    } catch {
      /* fallback em memoria */
    }
  }
  return FALLBACK_SECURITY_LOGS.slice(-limit).reverse();
}
