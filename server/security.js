// Seguranca HTTP: cabecalhos de protecao, limite de tentativas (rate limit)
// e utilitarios de IP/origem. Tudo em memoria - suficiente para uma instancia
// unica no plano gratuito do Render.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

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

/** 127.0.0.1 / IP real por tras de proxy confiavel (usa o IP adicionado pelo proxy). */
export function clientIp(req) {
  const trustProxy = process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production';
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      const parts = forwarded.split(',').map((item) => item.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
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
    /** @returns {{ allowed: boolean, retryAfterSeconds: number, remaining: number, message?: string }} */
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

/** DSR / LGPD: 10 solicitacoes por hora por IP. */
export const dsrLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Limite de solicitacoes LGPD atingido. Tente novamente mais tarde.',
});

/* -------------------- Anonimizacao de IP & Protecao LGPD ------------------- */

/** Anonimiza enderecos IP para logs e auditoria em conformidade com a LGPD. */
export function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '0.0.0.0';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}:****:****:****`;
  }
  return '***.***.***.***';
}

/* ----------------------- Criptografia de Dados em Repouso ------------------ */

const EPHEMERAL_DEV_KEY = randomBytes(32);

function getEncryptionKey() {
  if (process.env.DATA_ENCRYPTION_KEY && /^[0-9a-f]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY)) {
    return Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATA_ENCRYPTION_KEY nao configurada em producao.');
  }
  return EPHEMERAL_DEV_KEY;
}

/** Criptografa dados sensiveis (PII) usando AES-256-GCM. */
export function encryptSensitiveField(plaintext) {
  if (typeof plaintext !== 'string') return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

/** Descriptografa dados usando AES-256-GCM. */
export function decryptSensitiveField(ciphertext) {
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith('enc:')) return ciphertext;
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 4) return ciphertext;
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encryptedText = parts[3];
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

/**
 * Valida a forca da senha conforme padrao de seguranca (OWASP / NIST).
 * Minimo de 8 caracteres, com maiuscula, minuscula, numero e caractere especial.
 */
export function validatePasswordStrength(password) {
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
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos um caractere especial.' };
  }
  return { valid: true };
}

/* ---------------------- Sanitizacao & Anti-XSS --------------------------- */

/** Sanitiza strings de entrada para impedir injecao XSS. */
export function sanitizeInput(value) {
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

const SECURITY_LOGS = [];
const MAX_LOG_ENTRIES = 500;

export function logSecurityEvent(type, details = {}, req = null) {
  const ip = req ? clientIp(req) : 'sistema';
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    ip_anonymized: anonymizeIp(ip),
    userAgent: req?.headers['user-agent']?.slice(0, 120) || 'n/a',
    details,
  };
  SECURITY_LOGS.push(entry);
  if (SECURITY_LOGS.length > MAX_LOG_ENTRIES) {
    SECURITY_LOGS.shift();
  }
  return entry;
}

export function getSecurityLogs(limit = 50) {
  return SECURITY_LOGS.slice(-limit).reverse();
}
