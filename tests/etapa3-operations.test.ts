// Testes automatizados da Etapa 3 — Operacao:
// 1. Rota interna /api/internal/run-reminders protegida por token (preservando idempotencia)
// 2. Fuso horario configurado por barbearia (timezone em shop_settings e barbershops)
// 3. Registro estruturado de erros (logStructuredError) e /health completo

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../server/paths.js';
import { getErrorStats, logStructuredError } from '../server/logger.js';
import { isValidTimeZone, nowMinutes, todayISO } from '../server/time.js';

const PORT = Number(process.env.ETAPA3_PORT || 3421);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'AdminOpPassword123';
const CRON_TOKEN = 'cron-secret-token-etapa3-999';

const workDir = mkdtempSync(join(tmpdir(), 'gb-etapa3-'));
const dbPath = join(workDir, 'etapa3.db');

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${label}`);
  }
}

const distServerPath = join(PROJECT_ROOT, 'dist', 'server', 'server.js');
const serverArgs = existsSync(distServerPath)
  ? ['--experimental-sqlite', distServerPath]
  : ['--experimental-sqlite', '--import', 'tsx', join(PROJECT_ROOT, 'server', 'server.ts')];

const child = spawn(process.execPath, serverArgs, {
  cwd: PROJECT_ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    ADMIN_PASSWORD,
    INTERNAL_CRON_TOKEN: CRON_TOKEN,
    DATABASE_PATH: dbPath,
    DATA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    TURSO_DATABASE_URL: '',
    TURSO_AUTH_TOKEN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer(timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return true;
    } catch {
      /* aguarda subir */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

interface HttpCallResult {
  status: number;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

async function apiCall(
  path: string,
  opts: {
    method?: string;
    cookie?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): Promise<HttpCallResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Origin: BASE,
    ...(opts.headers ?? {}),
  };
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

function cookieFrom(res: HttpCallResult): string {
  return (res.headers.get('set-cookie') || '').split(';')[0] ?? '';
}

console.log('\n--- Testes Etapa 3: Operacao, Cron Token, Timezone por Loja e /health ---');

try {
  const up = await waitForServer();
  assert.equal(up, true, 'Servidor de teste Etapa 3 nao iniciou');

  // 1. Endpoint interno /api/internal/run-reminders
  const noToken = await apiCall('/api/internal/run-reminders', { method: 'POST', body: {} });
  check('POST /api/internal/run-reminders sem token retorna 401', noToken.status === 401);

  const wrongToken = await apiCall('/api/internal/run-reminders', {
    method: 'POST',
    headers: { Authorization: 'Bearer token-errado' },
    body: {},
  });
  check('POST /api/internal/run-reminders com token invalido retorna 401', wrongToken.status === 401);

  const bearerOk = await apiCall('/api/internal/run-reminders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_TOKEN}` },
    body: {},
  });
  check(
    'POST /api/internal/run-reminders com Bearer token valido responde 200',
    bearerOk.status === 200 && bearerOk.body?.ok === true && typeof bearerOk.body?.ran_at === 'string'
  );

  const headerOk = await apiCall('/api/internal/run-reminders', {
    method: 'POST',
    headers: { 'X-Internal-Token': CRON_TOKEN },
    body: {},
  });
  check(
    'POST /api/internal/run-reminders aceita X-Internal-Token mantendo idempotencia',
    headerOk.status === 200 && headerOk.body?.sent === 0
  );

  // 2. Timezone por barbearia
  check('isValidTimeZone valida fusos IANA corretamente', isValidTimeZone('America/Sao_Paulo') && !isValidTimeZone('Mars/Olympus'));
  const fixedNow = new Date('2026-06-15T15:00:00Z');
  check(
    'nowMinutes respeita diferenca de fuso horario (Sao_Paulo vs Manaus)',
    nowMinutes(fixedNow, 'America/Sao_Paulo') - nowMinutes(fixedNow, 'America/Manaus') === 60 &&
      todayISO(fixedNow, 'America/Sao_Paulo') === '2026-06-15'
  );

  const login1 = await apiCall('/api/auth/login', {
    method: 'POST',
    body: { password: ADMIN_PASSWORD },
  });
  let cookie1 = cookieFrom(login1);
  const unlock1 = await apiCall('/api/settings/password', {
    method: 'POST',
    cookie: cookie1,
    body: { current_password: ADMIN_PASSWORD, new_password: 'AdminOpChanged123' },
  });
  cookie1 = cookieFrom(unlock1);

  const badTz = await apiCall('/api/settings', {
    method: 'PUT',
    cookie: cookie1,
    body: { timezone: 'Invalid/Zone' },
  });
  check('PUT /api/settings rejeita timezone invalido (400)', badTz.status === 400);

  const saveTz1 = await apiCall('/api/settings', {
    method: 'PUT',
    cookie: cookie1,
    body: { timezone: 'America/Sao_Paulo' },
  });
  check('barbearia 1 salva timezone America/Sao_Paulo', saveTz1.status === 200 && saveTz1.body?.timezone === 'America/Sao_Paulo');

  const reg2 = await apiCall('/api/auth/register-shop', {
    method: 'POST',
    body: {
      shop_name: 'Barbearia Manaus',
      name: 'Dono Manaus',
      email: 'manaus@teste.com',
      password: 'ManausPassword123',
    },
  });
  const cookie2 = cookieFrom(reg2);
  const saveTz2 = await apiCall('/api/settings', {
    method: 'PUT',
    cookie: cookie2,
    body: { timezone: 'America/Manaus' },
  });
  check('barbearia 2 salva timezone isolado America/Manaus', saveTz2.status === 200 && saveTz2.body?.timezone === 'America/Manaus');

  const settings1After = await apiCall('/api/settings', { cookie: cookie1 });
  check('barbearia 1 mantem timezone America/Sao_Paulo sem interferencia', settings1After.body?.timezone === 'America/Sao_Paulo');

  // 3. Registro de erros estruturado e endpoint /health completo
  const capturedLines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    capturedLines.push(args.map((a) => String(a)).join(' '));
  };
  try {
    logStructuredError(new Error('Falha simulada de integracao'), {
      requestId: 'req-test-1',
      method: 'GET',
      path: '/api/test',
      status: 500,
    });
  } finally {
    console.error = origErr;
  }
  const parsedLog = JSON.parse(capturedLines[0] || '{}') as Record<string, unknown>;
  const errStats = getErrorStats();
  check(
    'logStructuredError emite JSON estruturado com request_id e nivel error',
    parsedLog.level === 'error' && parsedLog.request_id === 'req-test-1' && errStats.total_errors >= 1
  );

  const healthRes = await apiCall('/health');
  check('GET /health responde 200 com database ok', healthRes.status === 200 && healthRes.body?.database?.ok === true);
  check(
    'GET /health inclui fila de lembretes (reminders)',
    typeof healthRes.body?.reminders?.pending_queue === 'number' &&
      typeof healthRes.body?.reminders?.worker_active === 'boolean' &&
      'last_run_at' in (healthRes.body?.reminders ?? {})
  );
  check(
    'GET /health inclui status de WhatsApp (whatsapp.last_sent_at / last_status)',
    typeof healthRes.body?.whatsapp?.enabled === 'boolean' &&
      'last_sent_at' in (healthRes.body?.whatsapp ?? {}) &&
      'last_status' in (healthRes.body?.whatsapp ?? {})
  );
  check(
    'GET /health inclui resumo de erros estruturados',
    typeof healthRes.body?.errors?.total_errors === 'number'
  );

  assert.equal(failed, 0, `${failed} verificacao(oes) falharam na Etapa 3.`);
  console.log(`\n  OK: ${passed} verificacao(oes) da Etapa 3 aprovada(s), 0 falha(s).\n`);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (!child.killed) child.kill('SIGKILL');
  rmSync(workDir, { recursive: true, force: true });
}
