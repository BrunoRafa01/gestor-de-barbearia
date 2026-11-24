// Testes automatizados da Etapa 2 — Seguranca:
// 1. Revogacao de sessao por usuario (session_version), logout-all e renovacao deslizante (TTL 24h)
// 2. Politica unificada de senha (passwordIssue) e lista ampliada de senhas comuns
// 3. Logs de seguranca persistidos em tabela security_logs + retencao LGPD
// 4. Bloqueio progressivo de login por conta (independente de IP)
// 5. Remocao de sanitizeInput e uso canonico de esc() + safeUrl()
// 6. Prova anti-XSS com <img src=x onerror=alert(1)> em cliente, servico, notas e avaliacao
// 7. 2FA TOTP opcional para admin e obrigatorio para Master

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  SESSION_SLIDING_WINDOW_MS,
  SESSION_TTL_MS,
  createSessionToken,
  passwordIssue,
} from '../server/auth.js';
import { PROJECT_ROOT } from '../server/paths.js';
import * as securityModule from '../server/security.js';
import { todayISO, addDays } from '../server/time.js';
import { generateTotpCode } from '../server/totp.js';
import { esc, safeUrl } from '../src/client/escape.js';

const PORT = Number(process.env.ETAPA2_PORT || 3419);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'AdminPassword123';

const workDir = mkdtempSync(join(tmpdir(), 'gb-etapa2-'));
const dbPath = join(workDir, 'etapa2.db');

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

console.log('\n--- Testes Etapa 2: Seguranca, Sessoes, Logs DB, Lockout, XSS e 2FA TOTP ---');

try {
  const up = await waitForServer();
  assert.equal(up, true, 'Servidor de teste Etapa 2 nao iniciou');

  // 1. Politica unificada de senha e remocao de sanitizeInput / validatePasswordStrength
  check(
    'sanitizeInput foi removida de server/security.ts',
    !('sanitizeInput' in securityModule) && !('validatePasswordStrength' in securityModule)
  );
  const readme = readFileSync(join(PROJECT_ROOT, 'README.md'), 'utf8');
  check('README documenta escape de saida via esc() em src/client/ui.ts', readme.includes('src/client/ui.ts'));
  check('TTL de sessao reduzido para 24h com janela deslizante', SESSION_TTL_MS === 86_400_000 && SESSION_SLIDING_WINDOW_MS === 900_000);
  check('passwordIssue bloqueia senhas comuns ampliadas', passwordIssue('Barbearia123') !== null && passwordIssue('Senha1234') !== null);
  check('passwordIssue aceita senha forte valida', passwordIssue('SeguraForte2026') === null);

  // 2. Bloqueio progressivo por conta (mesmo mudando de IP a cada tentativa!)
  await apiCall('/api/auth/register-shop', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.1' },
    body: {
      shop_name: 'Barbearia Lockout',
      name: 'Dono Lock',
      email: 'lock@teste.com',
      password: 'LockPassword123',
    },
  });

  let accountLockedAt = 0;
  let retryAfterHeader = 0;
  for (let i = 1; i <= 7; i += 1) {
    const attempt = await apiCall('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': `198.51.100.${10 + i}` }, // IP diferente em toda tentativa!
      body: { email: 'lock@teste.com', password: `Errada${i}000` },
    });
    if (attempt.status === 429) {
      accountLockedAt = i;
      retryAfterHeader = Number(attempt.headers.get('retry-after') || 0);
      break;
    }
  }
  check('bloqueio por conta aciona mesmo rotacionando IPs (na 5a falha)', accountLockedAt === 5);
  check('bloqueio progressivo inicial define Retry-After >= 55s', retryAfterHeader >= 55);

  // Teste unitario da progressao (5 -> 60s, 8 -> 300s, 10 -> 900s)
  const baseNow = Date.now();
  for (let i = 1; i <= 10; i += 1) {
    const st = securityModule.recordAccountLoginFailure('prog@teste.com', baseNow + i * 100);
    if (i === 5) check('5 falhas bloqueiam por 60s', !st.allowed && st.retryAfterSeconds === 60);
    if (i === 8) check('8 falhas escalam bloqueio para 300s', !st.allowed && st.retryAfterSeconds === 300);
    if (i === 10) check('10 falhas escalam bloqueio para 900s', !st.allowed && st.retryAfterSeconds === 900);
  }
  securityModule.resetAccountLockout('prog@teste.com');
  check('resetAccountLockout libera a conta', securityModule.checkAccountLockout('prog@teste.com').allowed);

  // 3. Revogacao de sessao por usuario (session_version), troca de senha e logout-all
  const regUser = await apiCall('/api/auth/register-shop', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.20' },
    body: {
      shop_name: 'Barbearia Sessao',
      name: 'Dono Sessao',
      email: 'sessao@teste.com',
      password: 'SessaoPassword123',
    },
  });
  const deviceACookie = cookieFrom(regUser);
  const loginDeviceB = await apiCall('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.21' },
    body: { email: 'sessao@teste.com', password: 'SessaoPassword123' },
  });
  const deviceBCookie = cookieFrom(loginDeviceB);

  const changePw = await apiCall('/api/settings/password', {
    method: 'POST',
    cookie: deviceACookie,
    body: { current_password: 'SessaoPassword123', new_password: 'NovaSessaoPassword123' },
  });
  const deviceANewCookie = cookieFrom(changePw);
  check('troca de senha em conta multi-tenant responde 200', changePw.status === 200);

  const oldDeviceBCheck = await apiCall('/api/clients', { cookie: deviceBCookie });
  check('sessao do outro dispositivo e revogada apos troca de senha (401)', oldDeviceBCheck.status === 401);

  const newDeviceACheck = await apiCall('/api/clients', { cookie: deviceANewCookie });
  check('nova sessao apos troca de senha continua valida (200)', newDeviceACheck.status === 200);

  // Reabre segunda sessao e testa POST /api/auth/logout-all
  const loginDeviceC = await apiCall('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.22' },
    body: { email: 'sessao@teste.com', password: 'NovaSessaoPassword123' },
  });
  const deviceCCookie = cookieFrom(loginDeviceC);

  const logoutAll = await apiCall('/api/auth/logout-all', {
    method: 'POST',
    cookie: deviceANewCookie,
    body: {},
  });
  check('POST /api/auth/logout-all responde 200 e revoga todas as sessoes', logoutAll.status === 200 && logoutAll.body?.revoked === true);

  const afterLogoutAllA = await apiCall('/api/clients', { cookie: deviceANewCookie });
  const afterLogoutAllC = await apiCall('/api/clients', { cookie: deviceCCookie });
  check('todos os dispositivos ficam deslogados apos logout-all (401)', afterLogoutAllA.status === 401 && afterLogoutAllC.status === 401);

  // 4. Prova XSS (<img src=x onerror=alert(1)>) em cliente, servico, notas e avaliacao
  const adminLogin = await apiCall('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.50' },
    body: { password: ADMIN_PASSWORD },
  });
  let adminCookie = cookieFrom(adminLogin);
  // Troca senha inicial para liberar rotas administrativas
  const unlockAdmin = await apiCall('/api/settings/password', {
    method: 'POST',
    cookie: adminCookie,
    body: { current_password: ADMIN_PASSWORD, new_password: 'AdminForteChanged123' },
  });
  adminCookie = cookieFrom(unlockAdmin);

  const xssPayload = '<img src=x onerror=alert(1)>';
  const xssClient = await apiCall('/api/clients', {
    method: 'POST',
    cookie: adminCookie,
    body: { name: xssPayload, phone: '11966665555', notes: xssPayload },
  });
  const xssService = await apiCall('/api/services', {
    method: 'POST',
    cookie: adminCookie,
    body: { name: xssPayload, description: xssPayload, duration_min: 30, price: 50, active: 1 },
  });

  const xssBarber = await apiCall('/api/barbers', {
    method: 'POST',
    cookie: adminCookie,
    body: { name: xssPayload, phone: '11955554444', commission: 40, active: 1 },
  });
  const firstBarberId = Number(xssBarber.body?.id || 1);
  // Proxima segunda-feira util
  let targetDate = addDays(todayISO(), 1);
  while (new Date(`${targetDate}T12:00:00Z`).getUTCDay() === 0) {
    targetDate = addDays(targetDate, 1);
  }

  const xssAppt = await apiCall('/api/appointments', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      client_id: xssClient.body?.id,
      barber_id: firstBarberId,
      service_id: xssService.body?.id,
      date: targetDate,
      start_time: '10:00',
      status: 'confirmed',
      notes: xssPayload,
    },
  });
  const xssReview = await apiCall('/api/public/reviews', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.60' },
    body: {
      client_name: xssPayload,
      rating: 5,
      comment: xssPayload,
    },
  });

  check(
    'payload XSS gravado sem quebrar em cliente, servico, agendamento e avaliacao',
    xssClient.status === 201 && xssService.status === 201 && xssAppt.status === 201 && xssReview.status === 201
  );

  const [clientsList, servicesList, apptsList, reviewsList] = await Promise.all([
    apiCall('/api/clients', { cookie: adminCookie }),
    apiCall('/api/services', { cookie: adminCookie }),
    apiCall(`/api/appointments?date=${targetDate}`, { cookie: adminCookie }),
    apiCall('/api/public/reviews'),
  ]);

  // Renderiza fragmentos reais exatamente como o front-end faz com esc()
  const renderedHtml = [
    `<td><strong>${esc(clientsList.body?.[0]?.name)}</strong></td><td>${esc(clientsList.body?.[0]?.notes)}</td>`,
    `<div>${esc(servicesList.body?.find((s: { id: number }) => s.id === xssService.body?.id)?.name)}</div>`,
    `<div>${esc(apptsList.body?.[0]?.client_name)} - ${esc(apptsList.body?.[0]?.notes)}</div>`,
    `<div class="review-client"><strong>${esc(reviewsList.body?.[0]?.client_name)}</strong><p>${esc(reviewsList.body?.[0]?.comment)}</p></div>`,
  ].join('\n');

  check(
    'HTML renderizado escapa 100% dos payloads <img src=x onerror=alert(1)> sem tag executavel',
    !renderedHtml.includes('<img') &&
      renderedHtml.includes('&lt;img src=x onerror=alert(1)&gt;') &&
      safeUrl('javascript:alert(1)') === '#'
  );

  // 5. Logs de seguranca persistidos no SQLite e expurgo LGPD
  const secLogsRes = await apiCall('/api/admin/security-logs', { cookie: adminCookie });
  check(
    'GET /api/admin/security-logs retorna eventos persistidos na tabela security_logs',
    secLogsRes.status === 200 && Array.isArray(secLogsRes.body?.logs) && secLogsRes.body.logs.length >= 3
  );

  const directDb = new DatabaseSync(dbPath);
  try {
    const logCount = directDb.prepare('SELECT COUNT(*) AS total FROM security_logs').get() as { total: number };
    check('security_logs gravados fisicamente no banco SQLite', Number(logCount.total) >= 3);

    // Insere log antigo de 200 dias atras para validar expurgo LGPD
    directDb
      .prepare(
        `INSERT INTO security_logs (id, timestamp, type, ip_anonymized, user_agent, details_json, created_at)
         VALUES ('old-log-1', '2020-01-01T00:00:00.000Z', 'OLD_TEST', '127.0.***.***', 'test', '{}', '2020-01-01 00:00:00')`
      )
      .run();
  } finally {
    directDb.close();
  }

  // 6. 2FA por TOTP: opcional para admin, obrigatorio para Master
  const adminSetup2fa = await apiCall('/api/auth/2fa/setup', {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  });
  check('POST /api/auth/2fa/setup gera segredo Base32 e otpauth://', Boolean(adminSetup2fa.body?.secret) && String(adminSetup2fa.body?.otpauth_url).startsWith('otpauth://totp/'));

  const adminEnable2fa = await apiCall('/api/auth/2fa/enable', {
    method: 'POST',
    cookie: adminCookie,
    body: { code: generateTotpCode(String(adminSetup2fa.body.secret)) },
  });
  adminCookie = cookieFrom(adminEnable2fa) || adminCookie;
  check('POST /api/auth/2fa/enable ativa 2FA com codigo TOTP valido', adminEnable2fa.status === 200 && adminEnable2fa.body?.enabled === true);

  const loginWithout2fa = await apiCall('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.70' },
    body: { password: 'AdminForteChanged123' },
  });
  check('login sem codigo TOTP em conta com 2FA exige segundo fator (401 + requires_2fa)', loginWithout2fa.status === 401 && loginWithout2fa.body?.requires_2fa === true);

  const loginWith2fa = await apiCall('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.70' },
    body: {
      password: 'AdminForteChanged123',
      totp_code: generateTotpCode(String(adminSetup2fa.body.secret)),
    },
  });
  adminCookie = cookieFrom(loginWith2fa);
  check('login com codigo TOTP valido autentica com mfa_verified=true', loginWith2fa.status === 200 && loginWith2fa.body?.mfa_verified === true);

  const disableAdmin2fa = await apiCall('/api/auth/2fa/disable', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      password: 'AdminForteChanged123',
      code: generateTotpCode(String(adminSetup2fa.body.secret)),
    },
  });
  check('admin comum pode desativar 2FA opcional informando senha + TOTP', disableAdmin2fa.status === 200 && disableAdmin2fa.body?.enabled === false);

  // Conta Master: bloqueada sem 2FA, liberada com 2FA, proibida de desativar 2FA
  await apiCall('/api/auth/register-shop', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.80' },
    body: {
      shop_name: 'Master HQ',
      name: 'Master User',
      email: 'master-sec@novaruntime.local',
      password: 'MasterSecPassword123',
    },
  });
  const dbPromote = new DatabaseSync(dbPath);
  try {
    dbPromote.prepare("UPDATE users SET role = 'master' WHERE email = ?").run('master-sec@novaruntime.local');
  } finally {
    dbPromote.close();
  }

  const masterLoginNo2fa = await apiCall('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '203.0.113.81' },
    body: { email: 'master-sec@novaruntime.local', password: 'MasterSecPassword123' },
  });
  let masterCookie = cookieFrom(masterLoginNo2fa);

  const masterBlockedWithout2fa = await apiCall('/api/master/overview', { cookie: masterCookie });
  check('Painel Master bloqueia acesso (403) enquanto conta Master nao validar 2FA TOTP', masterBlockedWithout2fa.status === 403);

  const masterSetup = await apiCall('/api/auth/2fa/setup', {
    method: 'POST',
    cookie: masterCookie,
    body: {},
  });
  const masterEnable = await apiCall('/api/auth/2fa/enable', {
    method: 'POST',
    cookie: masterCookie,
    body: { code: generateTotpCode(String(masterSetup.body.secret)) },
  });
  masterCookie = cookieFrom(masterEnable) || masterCookie;

  const masterAllowedWith2fa = await apiCall('/api/master/overview', { cookie: masterCookie });
  check('Painel Master libera acesso (200) apos ativar/validar 2FA TOTP', masterAllowedWith2fa.status === 200);

  const masterCannotDisable = await apiCall('/api/auth/2fa/disable', {
    method: 'POST',
    cookie: masterCookie,
    body: {
      password: 'MasterSecPassword123',
      code: generateTotpCode(String(masterSetup.body.secret)),
    },
  });
  check('conta Master nao pode desativar 2FA obrigatorio (403)', masterCannotDisable.status === 403);

  // Encerra servidor para rodar expurgo LGPD no mesmo arquivo SQLite
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));

  const { runRetentionPurge } = await import('../scripts/retention-purge.js');
  const { closeDatabase } = await import('../server/db.js');
  const purgeRes = await runRetentionPurge({ dbPath, retentionDays: 180, silent: true });
  await closeDatabase();
  check('retention-purge remove security_logs antigos conforme LGPD', purgeRes.oldSecurityLogsDeleted >= 1);

  // Evita erro de unused import em createSessionToken
  assert.equal(typeof createSessionToken, 'function');
  assert.equal(failed, 0, `${failed} verificacao(oes) falharam na Etapa 2.`);
  console.log(`\n  OK: ${passed} verificacao(oes) da Etapa 2 aprovada(s), 0 falha(s).\n`);
} finally {
  if (!child.killed) child.kill('SIGKILL');
  rmSync(workDir, { recursive: true, force: true });
}
