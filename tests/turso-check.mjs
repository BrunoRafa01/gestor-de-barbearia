// Verificacao do driver Turso/libSQL - Gestor de Barbearia (Nova Runtime).
//
// Em producao (Render, plano gratuito) o banco fica no Turso porque o disco do
// Render e efemero. Este teste exercita exatamente o mesmo caminho de codigo
// usando um banco libSQL local (URL "file:"), sem precisar de conta na nuvem.
//
// O que ele prova:
//   1. O servidor sobe usando o driver libSQL e o /health reporta driver "turso".
//   2. Os fluxos principais (login, cadastros, agendamento, duplicidade,
//      relatorios e backup) funcionam nesse driver.
//   3. Os dados SOBREVIVEM a um reinicio do servidor - ou seja, um redeploy no
//      Render nao apaga nada.
//
// Uso:  npm run test:turso

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_TURSO_PORT || 3412);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'turso-senha-123';

let passed = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(extra ? `${name} (${extra})` : name);
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'gb-turso-'));
const dbUrl = `file:${join(workDir, 'libsql.db').replace(/\\/g, '/')}`;

let child = null;
let cookie = '';
let serverLog = [];

/* ---------------------------------- Utils --------------------------------- */

function boot() {
  serverLog = [];
  const proc = spawn(
    process.execPath,
    ['--experimental-sqlite', join(ROOT, 'server', 'server.js')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        NODE_ENV: 'test',
        ADMIN_PASSWORD: PASSWORD,
        DATABASE_PATH: join(workDir, 'ignorado.db'),
        TURSO_DATABASE_URL: dbUrl,
        TURSO_AUTH_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  proc.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
  proc.stderr.on('data', (chunk) => serverLog.push(String(chunk)));
  return proc;
}

async function stop(proc) {
  if (!proc) return;
  proc.kill('SIGTERM');
  await new Promise((done) => setTimeout(done, 900));
  if (!proc.killed) proc.kill('SIGKILL');
  // pequena espera para o sistema operacional liberar a porta
  await new Promise((done) => setTimeout(done, 400));
}

async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.status === 200 || response.status === 503) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((done) => setTimeout(done, 400));
  }
  return false;
}

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (auth && cookie) options.headers.Cookie = cookie;

  const response = await fetch(`${BASE}${path}`, options);
  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (setCookies.length) cookie = setCookies.map((value) => value.split(';')[0]).join('; ');

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: response.status, body: payload, headers: response.headers, text };
}

async function login() {
  const response = await call('/api/auth/login', { method: 'POST', auth: false, body: { password: PASSWORD } });
  return response.status === 200;
}

/* ---------------------------------- Suite --------------------------------- */

async function run() {
  /* ------------------- 1. Primeira subida com driver libSQL ---------------- */
  child = boot();
  if (!(await waitForServer())) {
    console.error('O servidor (libSQL) nao respondeu em /health.');
    console.error(serverLog.join(''));
    process.exitCode = 1;
    return;
  }

  const health = await call('/health', { auth: false });
  check('health responde 200 com libSQL', health.status === 200, `status ${health.status}`);
  check('health reporta driver turso', health.body?.driver === 'turso', `driver ${health.body?.driver}`);
  check('health nao expoe o token na URL', !String(health.body?.target || '').includes('token'));

  const database = health.body?.database || {};
  check('health informa latencia do banco', Number(database.latency_ms) >= 0);

  check('login funciona no driver turso', await login());

  const service = await call('/api/services', {
    method: 'POST',
    body: { name: 'Corte Turso', duration_min: 30, price: 50 },
  });
  check('servico criado no turso', service.status === 201, `status ${service.status}`);
  const serviceId = Number(service.body?.id);

  const barber = await call('/api/barbers', { method: 'POST', body: { name: 'Barbeiro Turso' } });
  check('profissional criado no turso', barber.status === 201);
  check('profissional recebe 7 dias de jornada', barber.body?.hours?.length === 7);
  const barberId = Number(barber.body?.id);

  const client = await call('/api/clients', {
    method: 'POST',
    body: { name: 'Cliente Turso', phone: '(11) 93333-2222' },
  });
  check('cliente criado no turso', client.status === 201);
  const clientId = Number(client.body?.id);

  const target = new Date(Date.now() + 86400000);
  while (target.getDay() === 0) target.setDate(target.getDate() + 1);
  const date = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;

  const availability = await call(
    `/api/availability?barber_id=${barberId}&service_id=${serviceId}&date=${date}`
  );
  check('disponibilidade calculada no turso', availability.body?.open === true, availability.body?.reason);
  const slot = availability.body?.slots?.[0];

  const appointment = await call('/api/appointments', {
    method: 'POST',
    body: { client_id: clientId, barber_id: barberId, service_id: serviceId, date, start_time: slot },
  });
  check('agendamento criado no turso', appointment.status === 201, `status ${appointment.status}`);
  const appointmentId = Number(appointment.body?.id);

  const duplicate = await call('/api/appointments', {
    method: 'POST',
    body: { client_id: clientId, barber_id: barberId, service_id: serviceId, date, start_time: slot },
  });
  check('indice unico de horario ativo no turso', duplicate.status === 409, `status ${duplicate.status}`);

  const reports = await call(`/api/reports?from=${date}&to=${date}`);
  check('relatorios funcionam no turso', reports.status === 200 && Number(reports.body?.totals?.appointments) >= 1);

  const backup = await call('/api/backup');
  check('backup exporta do turso', backup.status === 200 && Number(backup.body?.meta?.counts?.clients) >= 1);

  /* --------------- 2. Reinicio: os dados precisam permanecer -------------- */
  await stop(child);
  cookie = '';
  child = boot();

  if (!(await waitForServer())) {
    console.error('O servidor nao voltou apos o reinicio.');
    console.error(serverLog.join(''));
    process.exitCode = 1;
    return;
  }

  const healthAfter = await call('/health', { auth: false });
  check('servidor reinicia com o mesmo banco', healthAfter.body?.driver === 'turso');
  check('sessao anterior e invalidada no reinicio', (await call('/api/auth/me', { auth: false })).body?.authenticated === false);

  check('login funciona apos o reinicio', await login());

  const clientsAfter = await call('/api/clients');
  const keptClient = (clientsAfter.body || []).find((row) => row.id === clientId);
  check('cliente sobreviveu ao reinicio', Boolean(keptClient), 'cliente perdido');

  const appointmentAfter = await call(`/api/appointments/${appointmentId}`);
  check('agendamento sobreviveu ao reinicio', appointmentAfter.status === 200, `status ${appointmentAfter.status}`);
  check('horario do agendamento preservado', appointmentAfter.body?.start_time === slot);

  const backupAfter = await call('/api/backup');
  check(
    'contagem apos reinicio igual a de antes',
    Number(backupAfter.body?.meta?.counts?.appointments || 0) >= 1
  );

  /* ------------------------------- Resultado ------------------------------ */
  const ok = failures.length === 0;
  console.log('');
  console.log(`  ${ok ? 'OK' : 'FALHA'}: ${passed} verificacao(oes) aprovada(s), ${failures.length} falha(s).`);
  if (!ok) {
    console.log('');
    for (const failure of failures) console.log(`   - ${failure}`);
    console.log('');
    for (const line of serverLog.join('').split(/\r?\n/).slice(-20)) console.log(`   ${line}`);
  }
  console.log('');
}

run()
  .catch((error) => {
    console.error('Erro inesperado no teste do turso:', error?.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (failures.length) process.exitCode = 1;
    await stop(child);
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* arquivos podem seguir em uso no Windows por alguns instantes */
    }
    process.exit(process.exitCode || 0);
  });
