import { PASSWORD, call, check } from './harness.js';
import type { CatalogBookingContext } from './catalog-and-booking.js';

export async function runDashboardReportsSettingsChecks(ctx: CatalogBookingContext): Promise<void> {
  const { targetDate } = ctx;
  /* ------------------------------ 10. Dashboard --------------------------- */
  const dashboard = await call(`/api/dashboard?date=${targetDate}`);
  check('dashboard responde 200', dashboard.status === 200);
  check('dashboard traz resumo do dia', Number(dashboard.body?.today?.total) >= 1);
  check(
    'dashboard calcula receita prevista',
    Number(dashboard.body?.today?.revenue_expected) >= 45.5
  );
  check('dashboard calcula ocupacao', dashboard.body?.today?.occupancy?.rate !== undefined);
  check('dashboard traz proximos agendamentos', Array.isArray(dashboard.body?.upcoming));
  check('dashboard traz ranking de servicos', Array.isArray(dashboard.body?.top_services));
  check('dashboard traz ranking de profissionais', Array.isArray(dashboard.body?.top_barbers));
  check(
    'dashboard traz clients_total e recent_activity',
    typeof dashboard.body?.clients_total === 'number' &&
      dashboard.body.clients_total >= 1 &&
      Array.isArray(dashboard.body?.recent_activity) &&
      dashboard.body.recent_activity.length >= 1
  );

  /* ------------------------------ 11. Relatorios -------------------------- */
  const reports = await call(`/api/reports?from=${targetDate}&to=${targetDate}`);
  check('relatorios responde 200', reports.status === 200, `status ${reports.status}`);
  check('relatorios somam agendamentos', Number(reports.body?.totals?.appointments) >= 1);
  check('relatorios trazem taxas', typeof reports.body?.totals?.cancellation_rate === 'number');
  check('relatorios trazem serie diaria', Array.isArray(reports.body?.daily));
  check('relatorios trazem 7 dias da semana', reports.body?.by_weekday?.length === 7);
  check('relatorios trazem comissao por profissional', Array.isArray(reports.body?.by_barber));
  check('relatorios trazem servicos', Array.isArray(reports.body?.by_service));
  const repTotals = reports.body?.totals || {};
  const barberSum = ((reports.body?.by_barber as Array<{ total?: number }>) || []).reduce(
    (s: number, b: { total?: number }) => s + Number(b.total || 0),
    0
  );
  const serviceSum = ((reports.body?.by_service as Array<{ total?: number }>) || []).reduce(
    (s: number, sv: { total?: number }) => s + Number(sv.total || 0),
    0
  );
  check(
    'ranking de profissionais soma igual aos concluidos',
    barberSum === Number(repTotals.completed || 0)
  );
  check(
    'ranking de servicos soma igual aos concluidos',
    serviceSum === Number(repTotals.completed || 0)
  );
  const expectedAvg = repTotals.completed
    ? Number((Number(repTotals.revenue_realized) / Number(repTotals.completed)).toFixed(2))
    : 0;
  check(
    'ticket medio bate com receita realizada / concluidos',
    Number(repTotals.average_ticket) === expectedAvg
  );

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
  check(
    'horarios tem 7 dias',
    Array.isArray(businessHours.body) && businessHours.body.length === 7
  );

  const closure = await call('/api/closures', {
    method: 'POST',
    body: { date: '2027-01-02', reason: 'Feriado' },
  });
  check(
    'folga criada responde 201/200',
    [200, 201].includes(closure.status),
    `status ${closure.status}`
  );

  const closures = await call('/api/closures');
  check('folgas listadas', Array.isArray(closures.body) && closures.body.length >= 1);

  const duplicateClosure = await call('/api/closures', {
    method: 'POST',
    body: { date: '2027-01-02' },
  });
  check(
    'folga duplicada nao e aceita',
    [400, 409].includes(duplicateClosure.status),
    `status ${duplicateClosure.status}`
  );

}

export async function runBackupAndStabilizationChecks(ctx: CatalogBookingContext): Promise<void> {
  const { barberId, serviceId, clientId, targetDate } = ctx;
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
  check(
    'importar backup responde 200',
    importMerge.status === 200,
    `status ${importMerge.status}`
  );
  check('importacao informa modo', importMerge.body?.mode === 'merge');
  check('importacao devolve contagem', Number(importMerge.body?.counts?.services) >= 2);

  const importInvalid = await call('/api/backup/import', {
    method: 'POST',
    body: { mode: 'merge', data: { nada: [] } },
  });
  check('backup invalido responde 400', importInvalid.status === 400);

  const afterImport = await call('/api/appointments?limit=200');
  check('dados continuam acessiveis apos importar', Array.isArray(afterImport.body));

  /* ---------------------- 14.0 Estabilizacao Fase 1 ----------------------- */
  const delUsedClient = await call(`/api/clients/${clientId}`, { method: 'DELETE' });
  check(
    'nao permite excluir cliente com agendamentos (409)',
    delUsedClient.status === 409,
    `status ${delUsedClient.status}`
  );

  const farFuture = await call('/api/public/appointments', {
    method: 'POST',
    auth: false,
    body: {
      name: 'Cliente Futuro',
      phone: '11944443333',
      barber_id: barberId,
      service_id: serviceId,
      date: '2028-12-15',
      start_time: '10:00',
    },
  });
  check(
    'agendamento publico alem de max_advance_days responde 400',
    farFuture.status === 400,
    `status ${farFuture.status}`
  );

  const inactiveBarber = await call('/api/barbers', {
    method: 'POST',
    body: { name: 'Barbeiro Inativo', active: false },
  });
  check('barbeiro inativo criado', inactiveBarber.status === 201);
  const bookInactive = await call('/api/public/appointments', {
    method: 'POST',
    auth: false,
    body: {
      name: 'Teste Inativo',
      phone: '11933332222',
      barber_id: inactiveBarber.body?.id,
      service_id: serviceId,
      date: targetDate,
      start_time: '11:00',
    },
  });
  check(
    'agendamento com barbeiro inativo responde 409',
    bookInactive.status === 409,
    `status ${bookInactive.status}`
  );

  await call('/api/settings', { method: 'PUT', body: { min_advance_minutes: 10080 } });
  const blockedAdvance = await call(
    `/api/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`
  );
  check(
    'min_advance_minutes bloqueia tambem dias seguintes dentro da janela',
    blockedAdvance.status === 200 && blockedAdvance.body?.open === false,
    JSON.stringify(blockedAdvance.body)
  );
  await call('/api/settings', { method: 'PUT', body: { min_advance_minutes: 0 } });

}
