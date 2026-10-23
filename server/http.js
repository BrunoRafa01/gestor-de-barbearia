// Utilitarios HTTP: leitura de corpo, respostas JSON, cookies e arquivos estaticos.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(res, status, message, details = null) {
  sendJson(res, status, { error: message, details });
}

export function readJsonBody(req, limitBytes = 1024 * 512) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, 'Corpo da requisicao muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolvePromise(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, 'JSON invalido no corpo da requisicao.'));
      }
    });

    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function setCookie(res, name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  segments.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) segments.push('HttpOnly');
  segments.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) segments.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const header = segments.join('; ');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, header) : header);
}

export function clearCookie(res, name, options = {}) {
  setCookie(res, name, '', { ...options, maxAge: 0 });
}

/** Serve arquivos da pasta publica com protecao contra path traversal. */
export function serveStatic(req, res, publicDir, urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const root = resolve(publicDir);
  const target = join(root, normalize(relative));

  if (target !== root && !target.startsWith(root + sep)) {
    sendError(res, 403, 'Acesso negado.');
    return true;
  }

  if (!existsSync(target)) return false;
  const stats = statSync(target);
  if (stats.isDirectory()) return false;

  const extension = extname(target).toLowerCase();
  const isHtml = extension === '.html';
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300',
  });
  createReadStream(target).pipe(res);
  return true;
}
