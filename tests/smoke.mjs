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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 3411);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'teste-senha-123';

let passed = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(extra ? `${name} (${extra})` : name);
  }
}

function asDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Proximo dia em que a barbearia abre (domingo fechado por padrao). */
function nextOpenDay() {
  const date = new Date();
  for (let index = 1; index <= 10; index += 1) {
    const candidate = new Date(date.getTime() + index * 86400000);
    if (candidate.getDay() !== 0) return asDate(candidate);
  }
  return asDate(new Date(date.getTime() + 86400000));
}

/* ---------------------------- Servidor de teste ---------------------------- */

const workDir = mkdtempSync(join(tmpdir(), 'gb-smoke-'));
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
      DATABASE_PATH: join(workDir, 'teste.db'),
      TURSO_DATABASE_URL: '',
      TURSO_AUTH_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

child.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
child.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

let cookie = '';

async function waitForServer(timeoutMs = 30000) {
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

async function call(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const options = { method, headers: { ...headers } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (auth && cookie) options.headers.Cookie = cookie;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch (error) {
    throw new Error(`Falha em ${method} ${path}: ${error.message}`);
  }
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (setCookies.length) {
    cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
  }

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

/* --------------------------------- Suite ---------------------------------- */

async function run() {
  if (!(await waitForServer())) {
    console.error('O servidor de teste nao respondeu em /health.');
    console.error(serverLog.join(''));
    process.exitCode = 1;
    return;
  }

  /* ------------------------------ 1. Health ------------------------------- */
  const health = await call('/health', { auth: false });
  check('health responde 200', health.status === 200, `status ${health.status}`);
  check('health informa status ok', health.body?.status === 'ok');
  check('health informa o driver do banco', health.body?.driver === 'sqlite');
  check('health informa empresa', health.body?.company === 'Nova Runtime');
  check('health informa uptime', Number(health.body?.uptime_seconds) >= 0);

  /* --------------------------- 2. Cabecalhos HTTP ------------------------- */
  const csp = health.headers.get('content-security-policy') || '';
  check('CSP definido', csp.includes("default-src 'self'"));
  check('X-Frame-Options DENY', health.headers.get('x-frame-options') === 'DENY');
  check('X-Content-Type-Options nosniff', health.headers.get('x-content-type-options') === 'nosniff');
  check('Referrer-Policy definida', Boolean(health.headers.get('referrer-policy')));
  check('X-Request-Id presente', Boolean(health.headers.get('x-request-id')));
  check('HSTS ausente sem HTTPS', health.headers.get('strict-transport-security') === null);

  const secureProbe = await call('/health', {
    auth: false,
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9' },
  });
  check('HSTS presente atras de proxy HTTPS', Boolean(secureProbe.headers.get('strict-transport-security')));

  /* ----------------------------- 3. Arquivos ------------------------------ */
  const page = await call('/', { auth: false });
  check('pagina do painel responde 200', page.status === 200);
  check('pagina do painel e HTML', String(page.text).includes('<!DOCTYPE html>'));
  check('pagina do painel carrega o app.js', String(page.text).includes('/js/app.js'));

  const bookingPage = await call('/agendar', { auth: false });
  check('pagina publica responde 200', bookingPage.status === 200);
  check('pagina publica carrega agendar.js', String(bookingPage.text).includes('/js/agendar.js'));
  check('pagina publica tem link de contato', String(bookingPage.text).includes('shop-contact'));

  const css = await call('/css/app.css', { auth: false });
  check('CSS responde 200', css.status === 200);
  check('CSS contem o tema dourado', String(css.text).includes('--gold'));

  const notFound = await call('/api/nao-existe', { auth: false });
  check('endpoint inexistente responde 404', notFound.status === 404);

  /* --------------------------- 4. Autenticacao ---------------------------- */
  const anonymous = await call('/api/clients', { auth: false });
  check('API exige autenticacao', anonymous.status === 401, `status ${anonymous.status}`);

  const meAnonymous = await call('/api/auth/me', { auth: false });
  check('me informa sessao anonima', meAnonymous.body?.authenticated === false);

  const wrongLogin = await call('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { password: 'senha-errada' },
  });
  check('login com senha errada responde 401', wrongLogin.status === 401);

  const emptyLogin = await call('/api/auth/login', { method: 'POST', auth: false, body: {} });
  check('login sem senha responde 400', emptyLogin.status === 400);

  const login = await call('/api/auth/login', { method: 'POST', auth: false, body: { password: PASSWORD } });
  check('login correto responde 200', login.status === 200, `status ${login.status}`);
  check('login devolve cookie de sessao', cookie.includes('gb_session'), cookie);
  check('login informa autenticado', login.body?.authenticated === true);
  check('login nao expoe a senha', !JSON.stringify(login.body).includes(PASSWORD));

  const me = await call('/api/auth/me');
  check('me reconhece a sessao', me.body?.authenticated === true);

  /* ---------------------------- 5. Validacoes ----------------------------- */
  const serviceWithoutName = await call('/api/services', { method: 'POST', body: { duration_min: 30, price: 10 } });
  check('servico sem nome responde 400', serviceWithoutName.status === 400);

  const serviceBadDuration = await call('/api/services', {
    method: 'POST',
    body: { name: 'Teste', duration_min: 1, price: 10 },
  });
  check('duracao invalida responde 400', serviceBadDuration.status === 400);

  const serviceBadPrice = await call('/api/services', {
    method: 'POST',
    body: { name: 'Teste', duration_min: 30, price: -5 },
  });
  check('preco negativo responde 400', serviceBadPrice.status === 400);

  /* ---------------------------- 6. Cadastros ------------------------------ */
  const service = await call('/api/services', {
    method: 'POST',
    body: { name: 'Corte de cabelo', description: 'Corte na tesoura', duration_min: 30, price: 45.5 },
  });
  check('servico criado responde 201', service.status === 201, `status ${service.status}`);
  check('servico devolve id', Number(service.body?.id) > 0);
  check('servico devolve preco numerico', service.body?.price === 45.5);
  const serviceId = Number(service.body?.id);

  const beard = await call('/api/services', {
    method: 'POST',
    body: { name: 'Barba', duration_min: 30, price: 30 },
  });
  check('segundo servico criado', beard.status === 201);

  const barber = await call('/api/barbers', {
    method: 'POST',
    body: { name: 'Rafael Souza', phone: '(11) 98888-7777', commission: 40 },
  });
  check('profissional criado responde 201', barber.status === 201);
  check('profissional recebe horarios padrao', Array.isArray(barber.body?.hours) && barber.body.hours.length === 7);
  const barberId = Number(barber.body?.id);

  const badCommission = await call('/api/barbers', {
    method: 'POST',
    body: { name: 'Teste', commission: 500 },
  });
  check('comissao fora do intervalo responde 400', badCommission.status === 400);

  const client = await call('/api/clients', {
    method: 'POST',
    body: { name: 'Joao da Silva', phone: '(11) 97777-6666', email: 'joao@exemplo.com' },
  });
  check('cliente criado responde 201', client.status === 201);
  const clientId = Number(client.body?.id);

  const duplicatedClient = await call('/api/clients', {
    method: 'POST',
    body: { name: 'Joao Repetido', phone: '(11) 97777-6666' },
  });
  check('telefone duplicado responde 409', duplicatedClient.status === 409, `status ${duplicatedClient.status}`);

  const clientWithoutName = await call('/api/clients', {
    method: 'POST',
    body: { phone: '(11) 90000-0000' },
  });
  check('cliente sem nome responde 400', clientWithoutName.status === 400);

  const clientBadPhone = await call('/api/clients', {
    method: 'POST',
    body: { name: 'Sem DDD', phone: '123' },
  });
  check('telefone invalido responde 400', clientBadPhone.status === 400);

  /* --------------------------- 7. Disponibilidade ------------------------- */
  const targetDate = nextOpenDay();

  const availability = await call(
    `/api/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`
  );
  check('disponibilidade responde 200', availability.status === 200);
  check('dia de funcionamento esta aberto', availability.body?.open === true, availability.body?.reason);
  check('disponibilidade lista horarios', Array.isArray(availability.body?.slots) && availability.body.slots.length > 0);

  const availabilityRange = await call(
    `/api/availability/range?barber_id=${barberId}&service_id=${serviceId}&from=${targetDate}&days=3`
  );
  check('faixa de disponibilidade responde 200', availabilityRange.status === 200);
  check('faixa devolve lista de dias', Array.isArray(availabilityRange.body) && availabilityRange.body.length === 3);

  const slot = availability.body?.slots?.[0];

  /* ---------------------------- 8. Agendamentos --------------------------- */
  const appointment = await call('/api/appointments', {
    method: 'POST',
    body: { client_id: clientId, barber_id: barberId, service_id: serviceId, date: targetDate, start_time: slot },
  });
  check('agendamento criado responde 201', appointment.status === 201, `status ${appointment.status}`);
  check('agendamento calcula hora final', Boolean(appointment.body?.end_time));
  check('agendamento usa o preco do servico', appointment.body?.price === 45.5);
  check('agendamento nasce pendente', appointment.body?.status === 'pending');
  check('agendamento registra a origem admin', appointment.body?.source === 'admin');
  const appointmentId = Number(appointment.body?.id);

  const duplicate = await call('/api/appointments', {
    method: 'POST',
    body: { client_id: clientId, barber_id: barberId, service_id: serviceId, date: targetDate, start_time: slot },
  });
  check('agendamento duplicado responde 409', duplicate.status === 409, `status ${duplicate.status}`);
  check('mensagem de duplicidade clara', String(duplicate.body?.error || '').length > 10);

  const outsideHours = await call('/api/appointments', {
    method: 'POST',
    body: { client_id: clientId, barber_id: barberId, service_id: serviceId, date: targetDate, start_time: '03:00' },
  });
  check('horario fora do funcionamento responde 400/409', [400, 409].includes(outsideHours.status), `status ${outsideHours.status}`);

  const sunday = (() => {
    const date = new Date();
    for (let index = 1; index <= 10; index += 1) {
      const candidate = new Date(date.getTime() + index * 86400000);
      if (candidate.getDay() === 0) return asDate(candidate);
    }
    return null;
  })();
  if (sunday) {
    const closedDay = await call('/api/appointments', {
      method: 'POST',
      body: { client_id: clientId, barber_id: barberId, service_id: serviceId, date: sunday, start_time: '10:00' },
    });
    check('agendamento em dia fechado responde 400/409', [400, 409].includes(closedDay.status), `status ${closedDay.status}`);
  }

  const statusUpdate = await call(`/api/appointments/${appointmentId}/status`, {
    method: 'PATCH',
    body: { status: 'confirmed' },
  });
  check('confirmar agendamento responde 200', statusUpdate.status === 200);
  check('status atualizado para confirmado', statusUpdate.body?.status === 'confirmed');

  const badStatus = await call(`/api/appointments/${appointmentId}/status`, {
    method: 'PATCH',
    body: { status: 'inexistente' },
  });
  check('status invalido responde 400', badStatus.status === 400);

  const listByRange = await call(`/api/appointments?from=${targetDate}&to=${targetDate}`);
  check('listagem por periodo responde 200', listByRange.status === 200);
  check('listagem encontra o agendamento', Array.isArray(listByRange.body) && listByRange.body.length >= 1);

  const detail = await call(`/api/appointments/${appointmentId}`);
  check('detalhe do agendamento responde 200', detail.status === 200);
  check('detalhe traz o nome do cliente', detail.body?.client_name === 'Joao da Silva');

  const updateNotes = await call(`/api/appointments/${appointmentId}`, {
    method: 'PUT',
    body: {
      notes: 'Cliente prefere corte degradê na navalha',
    },
  });
  check('atualizar notas do agendamento responde 200', updateNotes.status === 200);
  check('notas atualizadas persistem', updateNotes.body?.notes === 'Cliente prefere corte degradê na navalha');

  const missingAppointment = await call('/api/appointments/999999');
  check('agendamento inexistente responde 404', missingAppointment.status === 404);

  /* ------------------------------ 9. WhatsApp ----------------------------- */
  const whatsapp = await call(`/api/appointments/${appointmentId}/whatsapp`);
  check('link de WhatsApp responde 200', whatsapp.status === 200);
  check('link usa wa.me', String(whatsapp.body?.link || '').startsWith('https://wa.me/'));
  check('link codifica a mensagem', String(whatsapp.body?.link || '').includes('Joao'));

  /* ------------------------------ 10. Dashboard --------------------------- */
  const dashboard = await call(`/api/dashboard?date=${targetDate}`);
  check('dashboard responde 200', dashboard.status === 200);
  check('dashboard traz resumo do dia', Number(dashboard.body?.today?.total) >= 1);
  check('dashboard calcula receita prevista', Number(dashboard.body?.today?.revenue_expected) >= 45.5);
  check('dashboard calcula ocupacao', dashboard.body?.today?.occupancy?.rate !== undefined);
  check('dashboard traz proximos agendamentos', Array.isArray(dashboard.body?.upcoming));
  check('dashboard traz ranking de servicos', Array.isArray(dashboard.body?.top_services));
  check('dashboard traz ranking de profissionais', Array.isArray(dashboard.body?.top_barbers));

  /* ------------------------------ 11. Relatorios -------------------------- */
  const reports = await call(`/api/reports?from=${targetDate}&to=${targetDate}`);
  check('relatorios responde 200', reports.status === 200, `status ${reports.status}`);
  check('relatorios somam agendamentos', Number(reports.body?.totals?.appointments) >= 1);
  check('relatorios trazem taxas', typeof reports.body?.totals?.cancellation_rate === 'number');
  check('relatorios trazem serie diaria', Array.isArray(reports.body?.daily));
  check('relatorios trazem 7 dias da semana', reports.body?.by_weekday?.length === 7);
  check('relatorios trazem comissao por profissional', Array.isArray(reports.body?.by_barber));
  check('relatorios trazem servicos', Array.isArray(reports.body?.by_service));

  const invalidRange = await call('/api/reports?from=2026-05-10&to=2026-05-01');
  check('periodo invertido responde 400', invalidRange.status === 400);

  const longRange = await call('/api/reports?from=2000-01-01&to=2026-01-01');
  check('periodo longo demais responde 400', longRange.status === 400);

  /* ---------------------------- 12. Configuracoes ------------------------- */
  const settings = await call('/api/settings');
  check('configuracoes respondem 200', settings.status === 200);
  check('configuracoes trazem o nome da loja', Boolean(settings.body?.shop_name));

  const updateSettings = await call('/api/settings', {
    method: 'PUT',
    body: { shop_name: 'Barbearia Nova Runtime', shop_whatsapp: '(11) 91111-2222' },
  });
  check('atualizar configuracoes responde 200', updateSettings.status === 200);

  const reread = await call('/api/settings');
  check('configuracao persistida', reread.body?.shop_name === 'Barbearia Nova Runtime');

  const businessHours = await call('/api/business-hours');
  check('horarios de funcionamento respondem 200', businessHours.status === 200);
  check('horarios tem 7 dias', Array.isArray(businessHours.body) && businessHours.body.length === 7);

  const closure = await call('/api/closures', { method: 'POST', body: { date: '2027-01-02', reason: 'Feriado' } });
  check('folga criada responde 201/200', [200, 201].includes(closure.status), `status ${closure.status}`);

  const closures = await call('/api/closures');
  check('folgas listadas', Array.isArray(closures.body) && closures.body.length >= 1);

  const duplicateClosure = await call('/api/closures', { method: 'POST', body: { date: '2027-01-02' } });
  check('folga duplicada nao e aceita', [400, 409].includes(duplicateClosure.status), `status ${duplicateClosure.status}`);

  /* --------------------------- 13. Pagina publica ------------------------- */
  const publicConfig = await call('/api/public/config', { auth: false });
  check('config publica responde 200', publicConfig.status === 200);
  check('config publica traz servicos', publicConfig.body?.services?.length >= 2);
  check('config publica traz profissionais', publicConfig.body?.barbers?.length >= 1);
  check('config publica nao vaza telefone do cliente', !JSON.stringify(publicConfig.body).includes('97777'));

  const publicAvailability = await call(
    `/api/public/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`,
    { auth: false }
  );
  check('disponibilidade publica responde 200', publicAvailability.status === 200);

  const publicCalendar = await call(
    `/api/public/calendar?barber_id=${barberId}&service_id=${serviceId}&from=${targetDate}&to=${targetDate}`,
    { auth: false }
  );
  check('calendario publico responde 200', publicCalendar.status === 200);
  check('calendario publico devolve dias', Array.isArray(publicCalendar.body));

  const publicSlot = (publicAvailability.body?.slots || []).find((value) => value !== slot) || slot;

  const publicBooking = await call('/api/public/appointments', {
    method: 'POST',
    auth: false,
    body: {
      name: 'Maria Publica',
      phone: '(11) 95555-4444',
      email: 'maria@exemplo.com',
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: publicSlot,
    },
  });
  check('agendamento publico responde 201', publicBooking.status === 201, `status ${publicBooking.status}`);
  check('agendamento publico nasce pendente', publicBooking.body?.appointment?.status === 'pending');
  check('agendamento publico gera link de confirmacao', String(publicBooking.body?.confirmation?.link || '').startsWith('https://wa.me/'));
  check('agendamento publico gera cancel_token', typeof publicBooking.body?.cancel_token === 'string' && publicBooking.body.cancel_token.length >= 32);
  check('agendamento publico gera manage_url', String(publicBooking.body?.manage_url || '').startsWith('/agendar?manage='));

  const cancelToken = publicBooking.body?.cancel_token;

  const publicDuplicate = await call('/api/public/appointments', {
    method: 'POST',
    auth: false,
    body: {
      name: 'Maria Publica',
      phone: '(11) 95555-4444',
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: publicSlot,
    },
  });
  check('duplicidade publica responde 409', publicDuplicate.status === 409, `status ${publicDuplicate.status}`);

  const publicLookup = await call(`/api/public/appointments/${cancelToken}`, { auth: false });
  check('consulta publica por token responde 200', publicLookup.status === 200);
  check('consulta publica traz dados do agendamento', publicLookup.body?.client_name === 'Maria Publica');
  check('consulta publica nao expoe cancel_token', publicLookup.body?.cancel_token === undefined);

  const publicLookupBadFormat = await call('/api/public/appointments/token-falso', { auth: false });
  check('consulta publica com formato invalido responde 400', publicLookupBadFormat.status === 400);

  const publicLookupNotFound = await call('/api/public/appointments/0123456789abcdef0123456789abcdef', { auth: false });
  check('consulta publica com token inexistente responde 404', publicLookupNotFound.status === 404);

  const publicCancel = await call(`/api/public/appointments/${cancelToken}/cancel`, {
    method: 'POST',
    auth: false,
    body: { reason: 'Imprevisto no trabalho' },
  });
  check('cancelamento publico por token responde 200', publicCancel.status === 200);
  check('cancelamento publico altera status para cancelled', publicCancel.body?.appointment?.status === 'cancelled');
  check('cancelamento publico salva motivo', publicCancel.body?.appointment?.cancellation_reason === 'Imprevisto no trabalho');

  const publicCancelAgain = await call(`/api/public/appointments/${cancelToken}/cancel`, {
    method: 'POST',
    auth: false,
    body: { reason: 'Tentando de novo' },
  });
  check('cancelar agendamento ja cancelado e idempotente (200)', publicCancelAgain.status === 200 && publicCancelAgain.body?.cancelled === true);

  const publicBadPhone = await call('/api/public/appointments', {
    method: 'POST',
    auth: false,
    body: { name: 'Sem telefone', phone: '123', barber_id: barberId, service_id: serviceId, date: targetDate, start_time: publicSlot },
  });
  check('telefone publico invalido responde 400', publicBadPhone.status === 400);

  /* ------------------------------ 14. Backup ------------------------------ */
  const backup = await call('/api/backup');
  check('exportar backup responde 200', backup.status === 200);
  check('backup traz metadados', backup.body?.meta?.company === 'Nova Runtime');
  check('backup traz tabelas', Array.isArray(backup.body?.meta?.tables));
  check('backup traz contagem', Number(backup.body?.meta?.counts?.appointments) >= 2);
  check('backup nao expoe session_secret', !JSON.stringify(backup.body).includes('session_secret'));
  check('backup nao expoe senha em texto', !JSON.stringify(backup.body).includes(PASSWORD));

  const importMerge = await call('/api/backup/import', {
    method: 'POST',
    body: { mode: 'merge', data: backup.body.data },
  });
  check('importar backup responde 200', importMerge.status === 200, `status ${importMerge.status}`);
  check('importacao informa modo', importMerge.body?.mode === 'merge');
  check('importacao devolve contagem', Number(importMerge.body?.counts?.services) >= 2);

  const importInvalid = await call('/api/backup/import', { method: 'POST', body: { mode: 'merge', data: { nada: [] } } });
  check('backup invalido responde 400', importInvalid.status === 400);

  const afterImport = await call('/api/appointments?limit=200');
  check('dados continuam acessiveis apos importar', Array.isArray(afterImport.body));

  /* ---------------------- 14.1 Troca de senha e revogacao ------------------- */
  const oldCookie = cookie;
  const passChange = await call('/api/settings/password', {
    method: 'POST',
    body: { current_password: PASSWORD, new_password: 'NovaSenhaForte123' },
  });
  check('troca de senha responde 200', passChange.status === 200);
  check('troca de senha devolve status updated', passChange.body?.updated === true);

  const callWithOldCookie = await call('/api/settings', { auth: false, headers: { Cookie: oldCookie } });
  check('cookie anterior e revogado apos troca de senha', callWithOldCookie.status === 401);

  const callWithNewCookie = await call('/api/settings');
  check('novo cookie autentica com sucesso', callWithNewCookie.status === 200);

  /* --------------------------- 15. Exit / logout -------------------------- */
  const logout = await call('/api/auth/logout', { method: 'POST' });
  check('logout responde 200', logout.status === 200);

  const afterLogout = await call('/api/clients', { auth: false, headers: { Cookie: cookie } });
  check('sessao encerrada bloqueia a API', afterLogout.status === 401, `status ${afterLogout.status}`);

  /* --------------------------- 16. Rate limiting -------------------------- */
  const attackerIp = '198.51.100.77';
  let blockedAt = 0;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await call('/api/auth/login', {
      method: 'POST',
      auth: false,
      headers: { 'X-Forwarded-For': attackerIp },
      body: { password: `tentativa-${attempt}` },
    });
    if (response.status === 429) {
      blockedAt = attempt;
      check('bloqueio informa Retry-After', Boolean(response.headers.get('retry-after')));
      break;
    }
  }
  check('rate limit bloqueia forca bruta', blockedAt > 0 && blockedAt <= 9, `bloqueou na tentativa ${blockedAt}`);

  /* ------------------------------- Limpeza -------------------------------- */
  const ok = failures.length === 0;
  console.log('');
  console.log(`  ${ok ? 'OK' : 'FALHA'}: ${passed} verificacao(oes) aprovada(s), ${failures.length} falha(s).`);
  if (!ok) {
    console.log('');
    for (const failure of failures) console.log(`   - ${failure}`);
    console.log('');
    console.log('  Ultimas linhas do servidor:');
    for (const line of serverLog.join('').split(/\r?\n/).slice(-20)) console.log(`   ${line}`);
  }
  console.log('');
}

run()
  .catch((error) => {
    console.error('Erro inesperado no teste:', error?.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (failures.length) process.exitCode = 1;
    child.kill('SIGTERM');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
    if (!child.killed) child.kill('SIGKILL');
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* pasta temporaria pode estar em uso no Windows */
    }
    process.exit(process.exitCode || 0);
  });
