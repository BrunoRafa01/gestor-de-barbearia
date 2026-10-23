// Seguranca HTTP: cabecalhos de protecao, limite de tentativas (rate limit)
// e utilitarios de IP/origem. Tudo em memoria - suficiente para uma instancia
// unica no plano gratuito do Render.

import { randomUUID } from 'node:crypto';

/* --------------------------- Cabecalhos de resposta ------------------------ */

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
};

/**
 * Aplica os cabecalhos de seguranca. `secure` liga o HSTS (apenas quando a
 * conexao e HTTPS, o que no Render acontece atraves do proxy TLS).
 */
export function applySecurityHeaders(res, { secure = false, requestId = null } = {}) {
  for (const [key, value] of Object.entries(BASE_HEADERS)) {
    res.setHeader(key, value);
  }
  if (secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (requestId) res.setHeader('X-Request-Id', requestId);
}

/** 127.0.0.1 / IP real por tras do proxy do Render. */
export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

/** Detecta HTTPS considerando o proxy reverso (Render) e o modo producao. */
export function isSecureRequest(req, trustProxy = true) {
  if (req.socket?.encrypted) return true;
  if (trustProxy) {
    const proto = req.headers['x-forwarded-proto'];
    if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') return true;
  }
  return process.env.NODE_ENV === 'production';
}

export function newRequestId() {
  return randomUUID().slice(0, 8);
}

/* ------------------------------- Rate limiting ----------------------------- */

/**
 * Limitador com janela deslizante simples.
 * @param {{ windowMs: number, max: number, message?: string }} options
 */
export function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    /** @returns {{ allowed: boolean, retryAfterSeconds: number, remaining: number }} */
    check(key) {
      const now = Date.now();
      if (hits.size > 5000) prune(now);

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

    reset(key) {
      hits.delete(key);
    },

    size() {
      return hits.size;
    },
  };
}

/** Login: 8 tentativas por 15 minutos por IP. */
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
});

/** Agendamento publico: 40 criacoes por 30 minutos por IP (anti-spam). */
export const publicBookingLimiter = createRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 40,
  message: 'Muitos agendamentos enviados deste dispositivo. Tente novamente mais tarde.',
});

/** Leitura publica (slots/calendario): 300 consultas por 10 minutos por IP. */
export const publicReadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 300,
  message: 'Muitas consultas seguidas. Aguarde alguns instantes.',
});
