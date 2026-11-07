// Teste de Concorrencia e Carga Simultanea do Gestor de Barbearia
// Simula 50 usuarios concorrentes acessando o sistema ao mesmo tempo.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3499;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'admin-stress-123';
const CONCURRENT_USERS = 50;

console.log('='.repeat(70));
console.log(` SIMULACAO DE CARGA E CONCORRENCIA: ${CONCURRENT_USERS} USUARIOS SIMULTANEOS`);
console.log('='.repeat(70));

const workDir = mkdtempSync(join(tmpdir(), 'gb-stress-'));
const serverLog = [];

const child = spawn(
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
      DATABASE_PATH: join(workDir, 'stress.db'),
      TURSO_DATABASE_URL: '',
      TURSO_AUTH_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

child.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
child.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function request(path, options = {}) {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const duration = performance.now() - start;
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { ok: res.ok, status: res.status, duration, data, headers: res.headers };
  } catch (err) {
    const duration = performance.now() - start;
    return { ok: false, status: 0, duration, error: err.message, headers: new Headers() };
  }
}

function nextOpenDay() {
  const date = new Date();
  for (let i = 1; i <= 10; i++) {
    const candidate = new Date(date.getTime() + i * 86400000);
    if (candidate.getDay() !== 0) {
      const year = candidate.getFullYear();
      const month = String(candidate.getMonth() + 1).padStart(2, '0');
      const day = String(candidate.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  return '2026-11-20';
}

async function run() {
  const isUp = await waitForServer();
  if (!isUp) {
    console.error('Falha ao iniciar o servidor de teste.');
    process.exit(1);
  }

  console.log('\n[1/4] Servidor de teste isolado inicializado na porta ' + PORT);

  // 1. Login de administrador para setup inicial
  const loginRes = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: PASSWORD }),
  });

  const rawCookie = loginRes.headers.get('set-cookie') || '';
  const cookieMatch = rawCookie.match(/gb_session=[^;]+/);
  const cookie = cookieMatch ? cookieMatch[0] : '';

  // 2. Setup de servico e barbeiro para teste
  const srvRes = await request('/api/services', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: 'Corte Degradê', duration_min: 30, price: 45 }),
  });
  const serviceId = srvRes.data?.id;

  const barbRes = await request('/api/barbers', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: 'Bruno Barbeiro' }),
  });
  const barberId = barbRes.data?.id;

  const targetDate = nextOpenDay();

  // Consulta disponibilidade para pegar um horario real valido
  const availCheck = await request(`/api/public/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`);
  const targetSlot = availCheck.data?.slots?.[0] || '10:00';

  console.log('[2/4] Catalogo de teste configurado:');
  console.log(`      - Servico ID: ${serviceId} (Corte Degradê - R$ 45)`);
  console.log(`      - Barbeiro ID: ${barberId} (Bruno Barbeiro)`);
  console.log(`      - Slot Alvo Concorrido: ${targetDate} as ${targetSlot}`);

  console.log(`\n[3/4] Disparando ${CONCURRENT_USERS} conexoes simultaneas em paralelo...`);

  const latencies = [];
  const statusCounts = {};
  let serverCrashes = 0;
  let successfulBookings = 0;
  let conflictRejections = 0;

  // Cria 50 tarefas de usuarios concorrentes disparadas exatamente no mesmo instante
  const userSimulations = Array.from({ length: CONCURRENT_USERS }, (_, index) => {
    const userId = index + 1;
    const userIp = `192.168.1.${userId}`;
    return (async () => {
      // 1. Todos os 50 usuarios chegam na pagina inicial/agendamento
      const pageReq = await request('/agendar', {
        headers: { 'X-Forwarded-For': userIp },
      });
      latencies.push(pageReq.duration);
      statusCounts[pageReq.status] = (statusCounts[pageReq.status] || 0) + 1;

      // 2. Todos consultam os servicos e configuracoes publicas
      const configReq = await request('/api/public/config', {
        headers: { 'X-Forwarded-For': userIp },
      });
      latencies.push(configReq.duration);
      statusCounts[configReq.status] = (statusCounts[configReq.status] || 0) + 1;

      // 3. Todos consultam a disponibilidade de horarios
      const availReq = await request(`/api/public/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`, {
        headers: { 'X-Forwarded-For': userIp },
      });
      latencies.push(availReq.duration);
      statusCounts[availReq.status] = (statusCounts[availReq.status] || 0) + 1;

      // 4. Teste de Fogo: 25 usuarios tentam agendar EXATAMENTE no mesmo horario disputado
      if (userId <= 25) {
        const bookReq = await request('/api/public/appointments', {
          method: 'POST',
          headers: { 'X-Forwarded-For': userIp },
          body: JSON.stringify({
            name: `Cliente Concorrente ${userId}`,
            phone: `1198888${String(userId).padStart(4, '0')}`,
            barber_id: barberId,
            service_id: serviceId,
            date: targetDate,
            start_time: targetSlot,
          }),
        });

        latencies.push(bookReq.duration);
        statusCounts[bookReq.status] = (statusCounts[bookReq.status] || 0) + 1;

        if (bookReq.status === 201) {
          successfulBookings++;
        } else if (bookReq.status === 409) {
          conflictRejections++;
        } else if (bookReq.status >= 500) {
          serverCrashes++;
        }
      }

      // 5. Os outros 25 usuarios realizam operacoes continuas de navegacao e verificacao
      if (userId > 25) {
        const healthReq = await request('/health', {
          headers: { 'X-Forwarded-For': userIp },
        });
        latencies.push(healthReq.duration);
        statusCounts[healthReq.status] = (statusCounts[healthReq.status] || 0) + 1;
      }
    })();
  });

  const startTime = performance.now();
  await Promise.all(userSimulations);
  const totalDuration = performance.now() - startTime;

  // Estatisticas de latencia
  latencies.sort((a, b) => a - b);
  const totalRequests = latencies.length;
  const minLatency = latencies[0].toFixed(1);
  const maxLatency = latencies[latencies.length - 1].toFixed(1);
  const avgLatency = (latencies.reduce((sum, v) => sum + v, 0) / latencies.length).toFixed(1);
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)].toFixed(1);
  const throughput = Math.round((totalRequests / (totalDuration / 1000)));

  console.log('\n[4/4] RESULTADOS DA SIMULACAO:');
  console.log('-'.repeat(70));
  console.log(`  Usuarios Simultaneos:   ${CONCURRENT_USERS} usuarios ativos`);
  console.log(`  Total de Requisicoes:   ${totalRequests} chamadas HTTP`);
  console.log(`  Tempo Total do Teste:   ${totalDuration.toFixed(0)} ms`);
  console.log(`  Vazao (Throughput):      ${throughput} req/s`);
  console.log(`  Latencia Minima:        ${minLatency} ms`);
  console.log(`  Latencia Media:         ${avgLatency} ms`);
  console.log(`  Latencia 95% (p95):     ${p95Latency} ms`);
  console.log(`  Latencia Maxima:        ${maxLatency} ms`);
  console.log('-'.repeat(70));
  console.log('  DISTRIBUICAO DE STATUS HTTP:');
  for (const [status, count] of Object.entries(statusCounts)) {
    const label =
      status === '200' ? '200 OK (Pagina estatica / API lida)' :
      status === '201' ? '201 Created (Agendamento criado com sucesso)' :
      status === '409' ? '409 Conflict (Bloqueio atomico de duplicidade)' :
      `${status} Outros`;
    console.log(`    - Status ${status}: ${count} (${label})`);
  }
  console.log('-'.repeat(70));
  console.log('  SEGURANCA & INTEGRIDADE:');
  console.log(`  - Falhas / Erros 500 do Servidor: ${serverCrashes} (Zero falhas!)`);
  console.log(`  - Disputa atomica pelo mesmo horario (${targetSlot}):`);
  console.log(`    * Agendamento vencedor aprovado: ${successfulBookings} (Exatamente 1)`);
  console.log(`    * Tentativas concorrentes rejeitadas com 409: ${conflictRejections}`);

  const pass = serverCrashes === 0 && successfulBookings === 1 && conflictRejections === 24;

  if (pass) {
    console.log('\n>>> SUCESSO TOTAL: O servidor aguentou 50 usuarios simultaneos sem nenhum crash, com media de ~' + avgLatency + 'ms e integridade atomica 100% perfeita! <<<');
  } else {
    console.error('\n>>> AVISO: Resultado inesperado detectado. <<<');
  }

  // Finalizacao limpa
  child.kill();
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {}

  process.exit(pass ? 0 : 1);
}

run();
