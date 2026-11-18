// Utilitarios HTTP: leitura de corpo, respostas JSON, cookies e arquivos estaticos.

import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AppRequest } from './types.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
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

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly details: unknown;

  constructor(status: number, message: string, details: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload === undefined ? null : payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(
  res: ServerResponse,
  status: number,
  message: string,
  details: unknown = null
): void {
  sendJson(res, status, { error: message, details });
}

export function readJsonBody<T = Record<string, unknown>>(
  req: AppRequest,
  limitBytes: number = 1024 * 512
): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
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
        resolvePromise({} as T);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      req.rawBody = raw;
      try {
        resolvePromise((raw ? JSON.parse(raw) : {}) as T);
      } catch {
        reject(new HttpError(400, 'JSON invalido no corpo da requisicao.'));
      }
    });

    req.on('error', reject);
  });
}

export function parseCookies(req: AppRequest): Record<string, string> {
  const header = req.headers.cookie;
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  }
  return cookies;
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  options: CookieOptions = {}
): void {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  segments.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) segments.push('HttpOnly');
  segments.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) segments.push('Secure');

  const existing = res.getHeader('Set-Cookie');
  const header = segments.join('; ');
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing.map(String), header]);
  } else if (existing !== undefined) {
    res.setHeader('Set-Cookie', [String(existing), header]);
  } else {
    res.setHeader('Set-Cookie', header);
  }
}

export function clearCookie(
  res: ServerResponse,
  name: string,
  options: CookieOptions = {}
): void {
  setCookie(res, name, '', { ...options, maxAge: 0 });
}

/** Serve arquivos de uma pasta publica com protecao contra path traversal. */
export function serveStatic(
  _req: AppRequest,
  res: ServerResponse,
  publicDir: string,
  urlPath: string
): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    sendError(res, 400, 'Caminho invalido.');
    return true;
  }

  const relative = decoded.replace(/^\/+/, '');
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
  const isRevalidated = extension === '.html' || extension === '.js' || extension === '.css';
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': isRevalidated ? 'no-cache' : 'public, max-age=300',
  });
  createReadStream(target).pipe(res);
  return true;
}
