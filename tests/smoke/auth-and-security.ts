import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateTotpCode } from '../../server/totp.js';
import {
  BASE,
  PASSWORD,
  call,
  check,
  getCookie,
  hhmmToMinutes,
  isWeakInitialPassword,
  nowMinutes,
  setCookie,
  todayISO,
  workDir,
} from './harness.js';

export async function runCoreAuthAndHealthChecks(): Promise<void> {
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
  check(
    'HSTS presente atras de proxy HTTPS',
    Boolean(secureProbe.headers.get('strict-transport-security'))
  );

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

  const prevTz = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  const brtLateNight = new Date('2026-11-16T02:30:00.000Z'); // 23:30 BRT de 15/11/2026
  check(
    '23:30 BRT (02:30 UTC) mantem dia 2026-11-15',
    todayISO(brtLateNight) === '2026-11-15',
    todayISO(brtLateNight)
  );
  check(
    '23:30 BRT calcula 1410 minutos',
    nowMinutes(brtLateNight) === 1410,
    String(nowMinutes(brtLateNight))
  );
  check(
    'antecedencia minima bloqueia 23:50 no mesmo dia',
    hhmmToMinutes('23:50') < nowMinutes(brtLateNight) + 60
  );
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;

  check(
    'senha inicial vazia ou comum e considerada fraca',
    isWeakInitialPassword('') && isWeakInitialPassword('admin123')
  );
  check('senha inicial forte e aceita', !isWeakInitialPassword('SenhaForte123'));

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

  const login = await call('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { password: PASSWORD },
  });
  check('login correto responde 200', login.status === 200, `status ${login.status}`);
  check('login devolve cookie de sessao', getCookie().includes('gb_session'), getCookie());
  check('login informa autenticado', login.body?.authenticated === true);
  check('login nao expoe a senha', !JSON.stringify(login.body).includes(PASSWORD));

  const me = await call('/api/auth/me');
  check('me reconhece a sessao', me.body?.authenticated === true);

  /* ---------------------------- 5. Validacoes ----------------------------- */
  const serviceWithoutName = await call('/api/services', {
    method: 'POST',
    body: { duration_min: 30, price: 10 },
  });
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

}

export async function runExtendedAuthMasterAndRateLimitChecks(
  monday: string,
  serviceId: number,
  barberId: number
): Promise<void> {
  const shop1Cookie = getCookie();
  /* ---------------------- 14.1 Troca de senha e revogacao ------------------- */
  const oldCookie = getCookie();
  const passChange = await call('/api/settings/password', {
    method: 'POST',
    body: { current_password: PASSWORD, new_password: 'NovaSenhaForte123' },
  });
  check('troca de senha responde 200', passChange.status === 200);
  check('troca de senha devolve status updated', passChange.body?.updated === true);

  const callWithOldCookie = await call('/api/settings', {
    auth: false,
    headers: { Cookie: oldCookie },
  });
  check('getCookie() anterior e revogado apos troca de senha', callWithOldCookie.status === 401);

  const callWithNewCookie = await call('/api/settings');
  check('novo getCookie() autentica com sucesso', callWithNewCookie.status === 200);

  /* --------------------------- 15. Exit / logout -------------------------- */
  const logout = await call('/api/auth/logout', { method: 'POST' });
  check('logout responde 200', logout.status === 200);

  const afterLogout = await call('/api/clients', { auth: false, headers: { Cookie: getCookie() } });
  check('sessao encerrada bloqueia a API', afterLogout.status === 401, `status ${afterLogout.status}`);

  /* ---------------- 16. Google OAuth & Multi-tenant Login ----------------- */
  const oauthProviders = await call('/api/auth/oauth/providers', { auth: false });
  check(
    'GET /api/auth/oauth/providers responde 200',
    oauthProviders.status === 200 && typeof oauthProviders.body?.google === 'boolean'
  );

  const googleStartUnconfigured = await call('/api/auth/oauth/google', { auth: false });
  check(
    'GET /api/auth/oauth/google retorna 503 sem configuracao',
    googleStartUnconfigured.status === 503
  );

  const oauthBadStateJson = await call('/api/auth/oauth/google/callback?state=forged&code=123', {
    auth: false,
    headers: { Accept: 'application/json' },
  });
  check('callback OAuth rejeita state invalido com 403', oauthBadStateJson.status === 403);

  const oauthBadStateBrowser = await fetch(
    `${BASE}/api/auth/oauth/google/callback?state=forged&code=123`,
    {
      redirect: 'manual',
    }
  );
  check(
    'callback OAuth redireciona browser para #login com oauth_error',
    oauthBadStateBrowser.status === 302 &&
      String(oauthBadStateBrowser.headers.get('location') || '').includes('oauth_error=')
  );

  const shopReg = await call('/api/auth/register-shop', {
    method: 'POST',
    auth: false,
    body: {
      shop_name: 'Barbearia OAuth Teste',
      name: 'Dono Teste',
      email: 'dono.teste@barbearia.local',
      password: 'DonoForte2026',
    },
  });
  check(
    'register-shop cria nova barbearia e usuario',
    shopReg.status === 201 && shopReg.body?.authenticated === true
  );

  const emailLogin = await call('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: {
      email: 'dono.teste@barbearia.local',
      password: 'DonoForte2026',
    },
  });
  check(
    'login com e-mail e senha funciona para usuario cadastrado',
    emailLogin.status === 200 && emailLogin.body?.authenticated === true
  );
  const emailLoginCookie = (emailLogin.headers.get('set-cookie') || '').split(';')[0] ?? '';
  const meEmail = await call('/api/auth/me', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  check(
    'GET /api/auth/me retorna user.email e oauth_providers',
    meEmail.status === 200 &&
      meEmail.body?.user?.email === 'dono.teste@barbearia.local' &&
      typeof meEmail.body?.oauth_providers?.google === 'boolean'
  );

  const shop2Clients = await call('/api/clients', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  const shop2Barbers = await call('/api/barbers', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  const shop2Services = await call('/api/services', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  const shop2Appts = await call('/api/appointments', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  const shop2CrossRead = await call('/api/appointments/1', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  const shop2Reports = await call('/api/reports', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });

  check(
    'isolamento multi-tenant bloqueia vazamento de clientes, barbeiros, servicos e agenda',
    Array.isArray(shop2Clients.body) &&
      shop2Clients.body.length === 0 &&
      Array.isArray(shop2Barbers.body) &&
      shop2Barbers.body.length === 0 &&
      Array.isArray(shop2Services.body) &&
      shop2Services.body.length === 0 &&
      Array.isArray(shop2Appts.body) &&
      shop2Appts.body.length === 0
  );
  check(
    'isolamento multi-tenant retorna 404 para agendamento de outra barbearia',
    shop2CrossRead.status === 404
  );
  check(
    'isolamento multi-tenant zera relatorios para nova barbearia',
    shop2Reports.status === 200 && shop2Reports.body?.totals?.appointments === 0
  );

  /* --------------------- 18. Financeiro & Isolamento --------------------- */
  await call('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { password: 'NovaSenhaForte123' },
  });
  

  const expCreate = await call('/api/finance/expenses', {
    method: 'POST',
    body: {
      description: 'Aluguel teste',
      category: 'Aluguel',
      amount: 120,
      date: todayISO(),
      payment_method: 'pix',
    },
  });
  check(
    'POST /api/finance/expenses registra despesa (201)',
    expCreate.status === 201 && expCreate.body?.id > 0
  );
  const expId = expCreate.body?.id;

  const fin1 = await call(`/api/finance/summary?from=${todayISO()}&to=${todayISO()}`);
  const s1 = fin1.body?.summary || {};
  check(
    'GET /api/finance/summary calcula lucro liquido real corretamente',
    fin1.status === 200 &&
      s1.total_expenses >= 120 &&
      Math.abs(
        Number(s1.net_profit) -
          Number(
            (
              Number(s1.revenue_realized) -
              Number(s1.total_commissions) -
              Number(s1.total_expenses)
            ).toFixed(2)
          )
      ) < 0.01
  );

  const fin2 = await call(`/api/finance/summary?from=${todayISO()}&to=${todayISO()}`, {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  check(
    'isolamento financeiro impede vazamento de despesas para outra barbearia',
    fin2.status === 200 && Array.isArray(fin2.body?.expenses) && fin2.body.expenses.length === 0
  );

  const expCrossDel = await call(`/api/finance/expenses/${expId}`, {
    method: 'DELETE',
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  check(
    'outra barbearia recebe 404 ao tentar excluir despesa alheia',
    expCrossDel.status === 404
  );

  const expDel = await call(`/api/finance/expenses/${expId}`, { method: 'DELETE' });
  check('DELETE /api/finance/expenses/:id remove despesa da propria barbearia', expDel.status === 200);

  /* --------------------- 19. Isolamento shop_settings -------------------- */
  const set2Put = await call('/api/settings', {
    method: 'PUT',
    auth: false,
    headers: { Cookie: emailLoginCookie },
    body: { shop_name: 'Barbearia Teste 2 Isolada' },
  });
  check(
    'PUT /api/settings salva configuracoes isoladas por barbearia',
    set2Put.status === 200 && set2Put.body?.shop_name === 'Barbearia Teste 2 Isolada'
  );
  const set1Get = await call('/api/settings');
  check(
    'GET /api/settings da barbearia 1 nao e sobrescrito pela barbearia 2',
    set1Get.status === 200 && set1Get.body?.shop_name !== 'Barbearia Teste 2 Isolada'
  );

  /* ---------------- 20. Painel Master & Suspensao de Loja ---------------- */
  const masterForbidden1 = await call('/api/master/overview');
  const masterForbidden2 = await call('/api/master/shops', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  check(
    'donos comuns recebem 403 nas rotas do Painel Master',
    masterForbidden1.status === 403 && masterForbidden2.status === 403
  );

  await call('/api/auth/register-shop', {
    method: 'POST',
    auth: false,
    headers: { 'X-Forwarded-For': '198.51.100.88' },
    body: {
      shop_name: 'Master Console Shop',
      name: 'Master Admin',
      email: 'master@novaruntime.local',
      password: 'MasterPassword123',
    },
  });
  const directDb = new DatabaseSync(join(workDir, 'teste.db'));
  directDb.prepare("UPDATE users SET role = 'master' WHERE email = ?").run('master@novaruntime.local');
  const migRow = directDb
    .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { total?: number | bigint } | undefined;
  if (Number(migRow?.total ?? 0) > 0) {
    const appliedRow = directDb
      .prepare('SELECT COUNT(*) AS total FROM schema_migrations')
      .get() as { total?: number | bigint } | undefined;
    check('schema_migrations registra migracoes aplicadas', Number(appliedRow?.total ?? 0) >= 1);
  }
  directDb.close();

  const masterLogin = await call('/api/auth/login', {
    method: 'POST',
    auth: false,
    headers: { 'X-Forwarded-For': '198.51.100.88' },
    body: { email: 'master@novaruntime.local', password: 'MasterPassword123' },
  });
  let masterCookie = (masterLogin.headers.get('set-cookie') || '').split(';')[0] ?? '';
  setCookie(shop1Cookie);
  const masterMe = await call('/api/auth/me', { auth: false, headers: { Cookie: masterCookie } });
  check(
    'usuario master autentica com is_master = true',
    masterMe.status === 200 && masterMe.body?.is_master === true
  );

  // Ativa 2FA TOTP obrigatorio para acessar as rotas do Painel Master
  const masterTotpSetup = await call('/api/auth/2fa/setup', {
    method: 'POST',
    auth: false,
    headers: { Cookie: masterCookie },
    body: {},
  });
  const masterTotpEnable = await call('/api/auth/2fa/enable', {
    method: 'POST',
    auth: false,
    headers: { Cookie: masterCookie },
    body: { code: generateTotpCode(String(masterTotpSetup.body?.secret || '')) },
  });
  const upgradedMasterCookie = (masterTotpEnable.headers.get('set-cookie') || '').split(';')[0] ?? '';
  if (upgradedMasterCookie) masterCookie = upgradedMasterCookie;

  const [mOverview, mShops, mLogs] = await Promise.all([
    call('/api/master/overview', { auth: false, headers: { Cookie: masterCookie } }),
    call('/api/master/shops', { auth: false, headers: { Cookie: masterCookie } }),
    call('/api/master/logs', { auth: false, headers: { Cookie: masterCookie } }),
  ]);
  check(
    'Painel Master retorna overview, barbearias e logs',
    mOverview.status === 200 &&
      mOverview.body?.shops?.total >= 2 &&
      mShops.status === 200 &&
      Array.isArray(mShops.body) &&
      mLogs.status === 200
  );

  const shop2Id = meEmail.body?.user?.shop_id as number | undefined;
  const shop2Suspend = await call(`/api/master/shops/${shop2Id}`, {
    method: 'PATCH',
    auth: false,
    headers: { Cookie: masterCookie },
    body: { active: false },
  });
  check(
    'Painel Master suspende barbearia 2',
    shop2Suspend.status === 200 && shop2Suspend.body?.active === false
  );

  const shop2Blocked = await call('/api/clients', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  const shop2Slug =
    (mShops.body as Array<{ id?: number; slug?: string }> | undefined)?.find(
      (s: { id?: number; slug?: string }) => s.id === shop2Id
    )?.slug || 'barbearia-oauth-teste';
  const shop2PublicBlocked = await call(`/api/public/config?shop=${shop2Slug}`, { auth: false });
  check(
    'barbearia suspensa recebe 403 no painel e 404 na vitrine publica',
    shop2Blocked.status === 403 && shop2PublicBlocked.status === 404,
    `panel=${shop2Blocked.status}, public=${shop2PublicBlocked.status}, slug=${shop2Slug}`
  );

  const shop2Reactivate = await call(`/api/master/shops/${shop2Id}`, {
    method: 'PATCH',
    auth: false,
    headers: { Cookie: masterCookie },
    body: { active: true, plan_id: 'pro' },
  });
  check(
    'Painel Master reativa barbearia 2 e atualiza plano',
    shop2Reactivate.status === 200 &&
      shop2Reactivate.body?.active === true &&
      shop2Reactivate.body?.plan_id === 'pro'
  );
  const shop2Restored = await call('/api/clients', {
    auth: false,
    headers: { Cookie: emailLoginCookie },
  });
  check('barbearia reativada volta a acessar o painel (200)', shop2Restored.status === 200);

  /* --------------------------- 21. Rate limiting -------------------------- */
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
  check(
    'rate limit bloqueia forca bruta',
    blockedAt > 0 && blockedAt <= 9,
    `bloqueou na tentativa ${blockedAt}`
  );

  void monday;
  void serviceId;
  void barberId;
}
