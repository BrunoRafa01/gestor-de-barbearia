// Teste de fumaca do Gestor de Barbearia - Nova Runtime.
//
// Sobe o servidor real em uma porta de teste, com um banco SQLite temporario,
// e valida os fluxos principais pela API HTTP: seguranca, autenticacao,
// cadastros, disponibilidade, agendamentos (inclusive duplicidade), WhatsApp,
// dashboard, relatorios, configuracoes, pagina publica e backup.
//
// Uso:  npm test
//
// Nada e escrito no banco real: tudo acontece em uma pasta temporaria.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWeakInitialPassword } from '../../server/auth.js';
import { PROJECT_ROOT } from '../../server/paths.js';
import { hhmmToMinutes, nowMinutes, todayISO } from '../../server/time.js';
import { generateTotpCode } from '../../server/totp.js';

export const PORT = Number(process.env.TEST_PORT || 3411);
export const BASE = `http://127.0.0.1:${PORT}`;
export const PASSWORD = 'TesteSenha123';

export let passed = 0;
export const failures: string[] = [];

export function check(name: string, condition: boolean, extra = ''): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(extra ? `${name} (${extra})` : name);
  }
}

/* ---------------------------- Servidor de teste ---------------------------- */

export const workDir = mkdtempSync(join(tmpdir(), 'gb-smoke-'));
export const serverLog: string[] = [];

const distServerPath = join(PROJECT_ROOT, 'dist', 'server', 'server.js');
const serverArgs = existsSync(distServerPath)
  ? ['--experimental-sqlite', distServerPath]
  : ['--experimental-sqlite', '--import', 'tsx', join(PROJECT_ROOT, 'server', 'server.ts')];

export const child = spawn(process.execPath, serverArgs, {
  cwd: PROJECT_ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    ADMIN_PASSWORD: PASSWORD,
    DATABASE_PATH: join(workDir, 'teste.db'),
    TURSO_DATABASE_URL: '',
    TURSO_AUTH_TOKEN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout?.on('data', (chunk: Buffer) => serverLog.push(String(chunk)));
child.stderr?.on('data', (chunk: Buffer) => serverLog.push(String(chunk)));

let cookie = '';

export async function waitForServer(timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.status === 200 || response.status === 503) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  return false;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CallResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(
  path: string,
  { method = 'GET', body, headers = {}, auth = true }: CallOptions = {}
): Promise<CallResponse<T>> {
  const reqHeaders: Record<string, string> = { ...headers };
  let serializedBody: string | undefined;
  if (body !== undefined) {
    reqHeaders['Content-Type'] = 'application/json';
    serializedBody = JSON.stringify(body);
  }
  if (auth && cookie) reqHeaders.Cookie = cookie;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: reqHeaders,
      body: serializedBody,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha em ${method} ${path}: ${message}`, { cause: error });
  }
  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (setCookies.length) {
    cookie = setCookies.map((value) => value.split(';')[0] ?? '').join('; ');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: response.status, body: payload as T, headers: response.headers, text };
}

export function getCookie(): string {
  return cookie;
}

export function setCookie(next: string): void {
  cookie = next;
}

export function getCounts(): { passed: number; failures: string[] } {
  return { passed, failures };
}

export { generateTotpCode, isWeakInitialPassword, hhmmToMinutes, nowMinutes, todayISO };
