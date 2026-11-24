import {
  BASE,
  call,
  check,
  getCookie,
  setCookie,
} from './harness.js';

function asDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextOpenDay(): string {
  const date = new Date();
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = new Date(date);
    candidate.setDate(date.getDate() + offset);
    if (candidate.getDay() !== 0) return asDate(candidate);
  }
  return asDate(date);
}

export interface CatalogBookingContext {
  barberId: number;
  serviceId: number;
  clientId: number;
  appointmentId: number;
  targetDate: string;
  slot: string;
}

export async function runCatalogAndBookingChecks(): Promise<CatalogBookingContext> {
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
  check(
    'profissional recebe horarios padrao',
    Array.isArray(barber.body?.hours) && barber.body.hours.length === 7
  );
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
  check(
    'telefone duplicado responde 409',
    duplicatedClient.status === 409,
    `status ${duplicatedClient.status}`
  );

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
  check(
    'dia de funcionamento esta aberto',
    availability.body?.open === true,
    String(availability.body?.reason ?? '')
  );
  check(
    'disponibilidade lista horarios',
    Array.isArray(availability.body?.slots) && availability.body.slots.length > 0
  );

  const availabilityRange = await call(
    `/api/availability/range?barber_id=${barberId}&service_id=${serviceId}&from=${targetDate}&days=3`
  );
  check('faixa de disponibilidade responde 200', availabilityRange.status === 200);
  check(
    'faixa devolve lista de dias',
    Array.isArray(availabilityRange.body) && availabilityRange.body.length === 3
  );

  const slot = availability.body?.slots?.[0] as string | undefined;

  /* ---------------------------- 8. Agendamentos --------------------------- */
  const appointment = await call('/api/appointments', {
    method: 'POST',
    body: {
      client_id: clientId,
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: slot,
    },
  });
  check(
    'agendamento criado responde 201',
    appointment.status === 201,
    `status ${appointment.status}`
  );
  check('agendamento calcula hora final', Boolean(appointment.body?.end_time));
  check('agendamento usa o preco do servico', appointment.body?.price === 45.5);
  check('agendamento nasce pendente', appointment.body?.status === 'pending');
  check('agendamento registra a origem admin', appointment.body?.source === 'admin');
  const appointmentId = Number(appointment.body?.id);

  const duplicate = await call('/api/appointments', {
    method: 'POST',
    body: {
      client_id: clientId,
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: slot,
    },
  });
  check(
    'agendamento duplicado responde 409',
    duplicate.status === 409,
    `status ${duplicate.status}`
  );
  check('mensagem de duplicidade clara', String(duplicate.body?.error || '').length > 10);

  // Sobreposicao parcial: +15 minutos dentro da duracao do primeiro agendamento
  const slotParts = String(slot).split(':').map(Number);
  const slotH = slotParts[0] ?? 0;
  const slotM = slotParts[1] ?? 0;
  const partialMinutes = slotH * 60 + slotM + 15;
  const partialSlot = `${String(Math.floor(partialMinutes / 60)).padStart(2, '0')}:${String(partialMinutes % 60).padStart(2, '0')}`;
  const partialOverlap = await call('/api/appointments', {
    method: 'POST',
    body: {
      client_id: clientId,
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: partialSlot,
    },
  });
  check(
    'sobreposicao parcial responde 409',
    partialOverlap.status === 409,
    `status ${partialOverlap.status}`
  );

  // Horario adjacente: exatamente no end_time do primeiro agendamento deve ser permitido
  const adjacentSlot = appointment.body?.end_time as string | undefined;
  const adjacent = await call('/api/appointments', {
    method: 'POST',
    body: {
      client_id: clientId,
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: adjacentSlot,
    },
  });
  check(
    'horario adjacente permitido responde 201',
    adjacent.status === 201,
    `status ${adjacent.status}`
  );

  // Agendamento cancelado nao bloqueia o horario
  if (adjacent.status === 201) {
    const adjacentId = Number(adjacent.body?.id);
    await call(`/api/appointments/${adjacentId}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled' },
    });
    const rebookAfterCancel = await call('/api/appointments', {
      method: 'POST',
      body: {
        client_id: clientId,
        barber_id: barberId,
        service_id: serviceId,
        date: targetDate,
        start_time: adjacentSlot,
      },
    });
    check(
      'agendamento cancelado nao bloqueia horario',
      rebookAfterCancel.status === 201,
      `status ${rebookAfterCancel.status}`
    );
    if (rebookAfterCancel.status === 201) {
      await call(`/api/appointments/${Number(rebookAfterCancel.body?.id)}`, { method: 'DELETE' });
    }
  }

  const outsideHours = await call('/api/appointments', {
    method: 'POST',
    body: {
      client_id: clientId,
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: '03:00',
    },
  });
  check(
    'horario fora do funcionamento responde 400/409',
    [400, 409].includes(outsideHours.status),
    `status ${outsideHours.status}`
  );

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
      body: {
        client_id: clientId,
        barber_id: barberId,
        service_id: serviceId,
        date: sunday,
        start_time: '10:00',
      },
    });
    check(
      'agendamento em dia fechado responde 400/409',
      [400, 409].includes(closedDay.status),
      `status ${closedDay.status}`
    );
  }

  const statusUpdate = await call(`/api/appointments/${appointmentId}/status`, {
    method: 'PATCH',
    body: { status: 'confirmed' },
  });
  check('confirmar agendamento responde 200', statusUpdate.status === 200);
  check('status atualizado para confirmado', statusUpdate.body?.status === 'confirmed');

  // Preco personalizado preservado ao editar apenas observacoes
  const customPriceSet = await call(`/api/appointments/${appointmentId}`, {
    method: 'PUT',
    body: { price: 32.5 },
  });
  check(
    'define preco personalizado',
    customPriceSet.status === 200 && customPriceSet.body?.price === 32.5
  );
  const notesOnlyUpdate = await call(`/api/appointments/${appointmentId}`, {
    method: 'PUT',
    body: { notes: 'Desconto VIP' },
  });
  check(
    'editar observacoes preserva preco personalizado',
    notesOnlyUpdate.status === 200 && notesOnlyUpdate.body?.price === 32.5
  );
  await call(`/api/appointments/${appointmentId}`, { method: 'PUT', body: { price: 45.5 } });

  const badStatus = await call(`/api/appointments/${appointmentId}/status`, {
    method: 'PATCH',
    body: { status: 'inexistente' },
  });
  check('status invalido responde 400', badStatus.status === 400);

  const listByRange = await call(`/api/appointments?from=${targetDate}&to=${targetDate}`);
  check('listagem por periodo responde 200', listByRange.status === 200);
  check(
    'listagem encontra o agendamento',
    Array.isArray(listByRange.body) && listByRange.body.length >= 1
  );

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
  check(
    'notas atualizadas persistem',
    updateNotes.body?.notes === 'Cliente prefere corte degradê na navalha'
  );

  const missingAppointment = await call('/api/appointments/999999');
  check('agendamento inexistente responde 404', missingAppointment.status === 404);

  /* ------------------------------ 9. WhatsApp ----------------------------- */
  const whatsapp = await call(`/api/appointments/${appointmentId}/whatsapp`);
  check('link de WhatsApp responde 200', whatsapp.status === 200);
  check('link usa wa.me', String(whatsapp.body?.link || '').startsWith('https://wa.me/'));
  check('link codifica a mensagem', String(whatsapp.body?.link || '').includes('Joao'));

  return { barberId, serviceId, clientId, appointmentId, targetDate, slot: slot ?? '' };
}

export async function runPublicAndMultiTenantChecks(ctx: CatalogBookingContext): Promise<void> {
  const { barberId, serviceId, clientId, targetDate, slot } = ctx;
  /* --------------------------- 13. Pagina publica ------------------------- */
  const publicConfig = await call('/api/public/config', { auth: false });
  check('config publica responde 200', publicConfig.status === 200);
  check('config publica traz servicos', publicConfig.body?.services?.length >= 2);
  check('config publica traz profissionais', publicConfig.body?.barbers?.length >= 1);
  check(
    'config publica nao vaza telefone do cliente',
    !JSON.stringify(publicConfig.body).includes('97777')
  );

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

  const publicSlot =
    ((publicAvailability.body?.slots as string[] | undefined) || []).find(
      (value: string) => value !== slot
    ) || slot;

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
  check(
    'agendamento publico responde 201',
    publicBooking.status === 201,
    `status ${publicBooking.status}`
  );
  check(
    'agendamento publico nasce pendente',
    publicBooking.body?.appointment?.status === 'pending'
  );
  check(
    'agendamento publico gera link de confirmacao',
    String(publicBooking.body?.confirmation?.link || '').startsWith('https://wa.me/')
  );
  check(
    'agendamento publico gera cancel_token',
    typeof publicBooking.body?.cancel_token === 'string' &&
      publicBooking.body.cancel_token.length >= 32
  );
  check(
    'agendamento publico gera manage_url',
    String(publicBooking.body?.manage_url || '').startsWith('/agendar?manage=')
  );

  const cancelToken = String(publicBooking.body?.cancel_token ?? '');

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
  check(
    'duplicidade publica responde 409',
    publicDuplicate.status === 409,
    `status ${publicDuplicate.status}`
  );

  const availAfterPublic = await call(
    `/api/public/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`,
    { auth: false }
  );
  const thirdSlot = availAfterPublic.body?.slots?.[0] as string | undefined;
  if (thirdSlot) {
    const renameAttempt = await call('/api/public/appointments', {
      method: 'POST',
      auth: false,
      body: {
        name: 'Nome Invasor',
        phone: '(11) 95555-4444',
        barber_id: barberId,
        service_id: serviceId,
        date: targetDate,
        start_time: thirdSlot,
      },
    });
    check(
      'agendamento publico com telefone existente nao renomeia cliente',
      renameAttempt.status === 201 &&
        renameAttempt.body?.appointment?.client_name === 'Maria Publica',
      `status ${renameAttempt.status} nome ${String(renameAttempt.body?.appointment?.client_name ?? '')}`
    );
  }

  const publicLookup = await call(`/api/public/appointments/${cancelToken}`, { auth: false });
  check('consulta publica por token responde 200', publicLookup.status === 200);
  check('consulta publica traz dados do agendamento', publicLookup.body?.client_name === 'Maria Publica');
  check('consulta publica nao expoe cancel_token', publicLookup.body?.cancel_token === undefined);

  const publicLookupBadFormat = await call('/api/public/appointments/token-falso', { auth: false });
  check('consulta publica com formato invalido responde 400', publicLookupBadFormat.status === 400);

  const publicLookupNotFound = await call(
    '/api/public/appointments/0123456789abcdef0123456789abcdef',
    { auth: false }
  );
  check('consulta publica com token inexistente responde 404', publicLookupNotFound.status === 404);

  const publicCancel = await call(`/api/public/appointments/${cancelToken}/cancel`, {
    method: 'POST',
    auth: false,
    body: { reason: 'Imprevisto no trabalho' },
  });
  check('cancelamento publico por token responde 200', publicCancel.status === 200);
  check(
    'cancelamento publico altera status para cancelled',
    publicCancel.body?.appointment?.status === 'cancelled'
  );
  check(
    'cancelamento publico salva motivo',
    publicCancel.body?.appointment?.cancellation_reason === 'Imprevisto no trabalho'
  );

  const publicCancelAgain = await call(`/api/public/appointments/${cancelToken}/cancel`, {
    method: 'POST',
    auth: false,
    body: { reason: 'Tentando de novo' },
  });
  check(
    'cancelar agendamento ja cancelado e idempotente (200)',
    publicCancelAgain.status === 200 && publicCancelAgain.body?.cancelled === true
  );

  const rescheduleCancelled = await call(`/api/public/appointments/${cancelToken}/reschedule`, {
    method: 'POST',
    auth: false,
    body: { date: targetDate, start_time: publicSlot },
  });
  check('reagendar agendamento cancelado responde 409', rescheduleCancelled.status === 409);

  const pageTokenRes = await fetch(`${BASE}/agendamento/${cancelToken}`);
  check('rota amigavel /agendamento/:token responde 200', pageTokenRes.status === 200);

  const availForReschedule = await call(
    `/api/public/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`,
    { auth: false }
  );
  const reschedSlot1 = availForReschedule.body?.slots?.[0] as string | undefined;
  const reschedSlot2 = availForReschedule.body?.slots?.[1] as string | undefined;
  const toReschedule = await call('/api/public/appointments', {
    method: 'POST',
    auth: false,
    body: {
      name: 'Cliente Reagendar',
      phone: '11922221111',
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: reschedSlot1,
    },
  });
  check('agendamento para reagendar criado', toReschedule.status === 201);
  const reschedToken = String(toReschedule.body?.cancel_token ?? '');
  const doReschedule = await call(`/api/public/appointments/${reschedToken}/reschedule`, {
    method: 'POST',
    auth: false,
    body: { date: targetDate, start_time: reschedSlot2 },
  });
  check(
    'reagendamento publico altera horario com sucesso (200)',
    doReschedule.status === 200 && doReschedule.body?.appointment?.start_time === reschedSlot2
  );
  const pastMonthDash = await call('/api/dashboard?date=2020-01-15');
  check(
    'dashboard em mes passado limita new_clients ao intervalo do mes',
    pastMonthDash.status === 200 && pastMonthDash.body?.month?.new_clients === 0
  );
  check(
    'dashboard traz revenue_realized semanal',
    typeof pastMonthDash.body?.week?.revenue_realized === 'number'
  );

  const publicBadPhone = await call('/api/public/appointments', {
    method: 'POST',
    auth: false,
    body: {
      name: 'Sem telefone',
      phone: '123',
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: publicSlot,
    },
  });
  check('telefone publico invalido responde 400', publicBadPhone.status === 400);

  const searchPercent = await call(`/api/appointments?search=${encodeURIComponent('%')}`);
  check(
    'busca com % escapado nao retorna todos agendamentos',
    searchPercent.status === 200 &&
      Array.isArray(searchPercent.body) &&
      searchPercent.body.length === 0
  );

  const searchClientPercent = await call(`/api/clients?search=${encodeURIComponent('%')}`);
  check(
    'busca de clientes com % escapado nao retorna todos',
    searchClientPercent.status === 200 &&
      Array.isArray(searchClientPercent.body) &&
      searchClientPercent.body.length === 0
  );

  const badWaVersion = await call('/api/settings', {
    method: 'PUT',
    body: { whatsapp_api_version: '../v18.0/me' },
  });
  check('whatsapp_api_version com path traversal responde 400', badWaVersion.status === 400);

  const badBusinessHour = await call('/api/business-hours', {
    method: 'PUT',
    body: {
      days: [{ weekday: 1, is_open: true, open_time: '29:99', close_time: '29:99' }],
    },
  });
  check('horario de funcionamento invalido (29:99) responde 400', badBusinessHour.status === 400);

  /* ---------------- 13.5 Bloqueios parciais e Multi-Tenant ---------------- */
  const blockCreate = await call('/api/blocks', {
    method: 'POST',
    body: {
      barber_id: barberId,
      date: targetDate,
      start_time: '14:00',
      end_time: '15:00',
      reason: 'Reuniao',
    },
  });
  check('bloqueio parcial criado (201)', blockCreate.status === 201);
  const availBlocked = await call(
    `/api/availability?barber_id=${barberId}&service_id=${serviceId}&date=${targetDate}`
  );
  check(
    'disponibilidade exclui horarios dentro do bloqueio',
    availBlocked.status === 200 && !availBlocked.body?.slots?.includes('14:00')
  );
  const bookInBlock = await call('/api/appointments', {
    method: 'POST',
    body: {
      client_id: clientId,
      barber_id: barberId,
      service_id: serviceId,
      date: targetDate,
      start_time: '14:00',
    },
  });
  check('agendamento dentro de bloqueio parcial responde 409', bookInBlock.status === 409);
  const blockDelete = await call(`/api/blocks/${blockCreate.body?.id}`, { method: 'DELETE' });
  check('remocao de bloqueio parcial responde 200', blockDelete.status === 200);

  const tenant1Cookie = getCookie();
  const regShop = await call('/api/auth/register-shop', {
    method: 'POST',
    auth: false,
    body: {
      shop_name: 'Barbearia Tenant Dois',
      name: 'Dono Dois',
      email: 'dono2@novaruntime.dev',
      password: 'Tenant2Password',
    },
  });
  check('register-shop cria nova barbearia SaaS (201)', regShop.status === 201);
  const tenant2Slug = String(regShop.body?.shop?.slug ?? '');
  const tenant2BarbersBefore = await call('/api/barbers');
  check(
    'tenant 2 inicia isolado sem profissionais do tenant 1',
    tenant2BarbersBefore.status === 200 && tenant2BarbersBefore.body?.length === 0
  );
  const tenant2Barber = await call('/api/barbers', {
    method: 'POST',
    body: { name: 'Barbeiro Exclusivo T2' },
  });
  check('tenant 2 cria seu proprio profissional (201)', tenant2Barber.status === 201);
  const pubTenant2 = await call(`/api/public/config?shop=${encodeURIComponent(tenant2Slug)}`, {
    auth: false,
  });
  check(
    'config publico por slug retorna apenas profissionais do tenant 2',
    pubTenant2.status === 200 &&
      pubTenant2.body?.barbers?.length === 1 &&
      pubTenant2.body?.barbers?.[0]?.name === 'Barbeiro Exclusivo T2'
  );

  // Fase 5: Planos SaaS e limites (Tenant 2 inicia no plano free: max 2 barbeiros)
  const planCheck = await call('/api/billing/plan');
  check(
    'billing/plan retorna plano free para novo tenant',
    planCheck.status === 200 && planCheck.body?.plan?.id === 'free'
  );
  const t2b2 = await call('/api/barbers', { method: 'POST', body: { name: 'Barbeiro 2 T2' } });
  check('tenant 2 free cria 2o profissional (201)', t2b2.status === 201);
  const t2b3 = await call('/api/barbers', { method: 'POST', body: { name: 'Barbeiro 3 T2' } });
  check('tenant 2 free bloqueia 3o profissional (403)', t2b3.status === 403);
  const upgrade = await call('/api/billing/upgrade', { method: 'POST', body: { plan_id: 'pro' } });
  check(
    'upgrade para plano pro responde 200',
    upgrade.status === 200 && upgrade.body?.plan?.id === 'pro'
  );
  const t2b3After = await call('/api/barbers', { method: 'POST', body: { name: 'Barbeiro 3 T2' } });
  check('apos upgrade pro permite 3o profissional (201)', t2b3After.status === 201);

  setCookie(tenant1Cookie);

}
