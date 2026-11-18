// Seguranca HTTP: cabecalhos de protecao, limite de tentativas (rate limit)
// e utilitarios de IP/origem. Tudo em memoria - suficiente para uma instancia
// unica no plano gratuito do Render.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
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

/** Criptografa dados sensiveis (PII) usando AES-256-GCM. */
export function encryptSensitiveField(plaintext: string): string;
export function encryptSensitiveField<T>(plaintext: T): T;
export function encryptSensitiveField(plaintext: unknown): unknown {
  if (typeof plaintext !== 'string') return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

/** Descriptografa dados usando AES-256-GCM. */
export function decryptSensitiveField(ciphertext: string): string;
export function decryptSensitiveField<T>(ciphertext: T): T;
export function decryptSensitiveField(ciphertext: unknown): unknown {
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith('enc:')) return ciphertext;
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 4) return ciphertext;
    const ivHex = parts[1];
    const tagHex = parts[2];
    const encryptedText = parts[3];
    if (!ivHex || !tagHex || encryptedText === undefined) return ciphertext;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return ciphertext;
  }
}

/* ----------------------- Rotina e Validacao de Senhas --------------------- */

export interface PasswordStrengthResult {
  valid: boolean;
  message?: string;
}

/**
 * Valida a forca da senha conforme padrao de seguranca (OWASP / NIST).
 * Minimo de 8 caracteres, com maiuscula, minuscula, numero e caractere especial.
 */
export function validatePasswordStrength(password: unknown): PasswordStrengthResult {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Senha obrigatoria.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'A senha deve ter no minimo 8 caracteres.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos uma letra maiuscula.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos uma letra minuscula.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos um numero.' };
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos um caractere especial.' };
  }
  return { valid: true };
}

/* ---------------------- Sanitizacao & Anti-XSS --------------------------- */

/** Sanitiza strings de entrada para impedir injecao XSS. */
export function sanitizeInput(value: string): string;
export function sanitizeInput<T>(value: T): T;
export function sanitizeInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
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

const SECURITY_LOGS: SecurityLogEntry[] = [];
const MAX_LOG_ENTRIES = 500;

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
  SECURITY_LOGS.push(entry);
  if (SECURITY_LOGS.length > MAX_LOG_ENTRIES) {
    SECURITY_LOGS.shift();
  }
  return entry;
}

export function getSecurityLogs(limit: number = 50): SecurityLogEntry[] {
  return SECURITY_LOGS.slice(-limit).reverse();
}
