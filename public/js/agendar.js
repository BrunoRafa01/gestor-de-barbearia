// Página pública de agendamento (mobile first) do Gestor de Barbearia.
// O cliente escolhe serviço, profissional, dia, horário e informa os dados.

import { api, query } from './api.js';
import {
  addDays,
  esc,
  formatDateBR,
  formatPhone,
  hhmmToMinutes,
  icon,
  initials,
  money,
  parseISO,
  statusPill,
  toast,
  todayISO,
  WEEKDAYS_SHORT,
} from './ui.js';

const state = {
  shop: null,
  services: [],
  barbers: [],
  serviceId: null,
  barberId: null,
  date: null,
  time: null,
  days: [],
  slots: [],
  slotsReason: '',
};

const content = () => document.getElementById('booking-content');
const daysLimit = () => Math.min(Number(state.shop?.max_advance_days) || 30, 30);

/* --------------------------------- Passos --------------------------------- */

function setStep(active) {
  document.querySelectorAll('#steps span').forEach((element) => {
    element.classList.toggle('active', Number(element.dataset.step) <= active);
  });
}

function currentStep() {
  if (!state.serviceId) return 1;
  if (!state.barberId) return 2;
  if (!state.date || !state.time) return 3;
  return 4;
}

/** Mostra a próxima seção e, no celular, rola suavemente até ela. */
function revealSection(id) {
  const element = document.getElementById(id);
  if (!element.classList.contains('hidden')) return;
  element.classList.remove('hidden');
  if (window.matchMedia('(max-width: 860px)').matches) {
    setTimeout(() => element.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
}

/* ---------------------------------- Layout -------------------------------- */

function skeletonHtml() {
  return `
    <div class="card" id="sec-service">
      <div class="card-header">
        <div class="kpi-icon" style="position:static">${icon('tag')}</div>
        <div><h3>1. Escolha o serviço</h3><div class="card-sub">Duração e valor de cada opção</div></div>
      </div>
      <div class="choice-grid" id="service-grid"></div>
    </div>

    <div class="card hidden" id="sec-barber">
      <div class="card-header">
        <div class="kpi-icon" style="position:static">${icon('scissors')}</div>
        <div><h3>2. Escolha o profissional</h3><div class="card-sub">Com quem você quer cortar?</div></div>
      </div>
      <div class="choice-grid" id="barber-grid"></div>
    </div>

    <div class="card hidden" id="sec-date">
      <div class="card-header">
        <div class="kpi-icon" style="position:static">${icon('calendar')}</div>
        <div><h3>3. Escolha o dia e o horário</h3><div class="card-sub">Horários livres atualizados em tempo real</div></div>
      </div>
      <div class="day-strip" id="day-strip"></div>
      <div id="slot-area" style="margin-top:16px"></div>
    </div>

    <div class="card hidden" id="sec-form">
      <div class="card-header">
        <div class="kpi-icon" style="position:static">${icon('check')}</div>
        <div><h3>4. Seus dados</h3><div class="card-sub">Usamos o WhatsApp para confirmação</div></div>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="field">
          <label for="pk-name">Seu nome</label>
          <input id="pk-name" name="name" placeholder="Nome completo" autocomplete="name" />
        </div>
        <div class="field">
          <label for="pk-phone">WhatsApp</label>
          <input id="pk-phone" name="phone" placeholder="(11) 99999-9999" inputmode="tel" autocomplete="tel" />
        </div>
        <div class="field">
          <label for="pk-email">E-mail (opcional)</label>
          <input id="pk-email" name="email" type="email" placeholder="voce@email.com" autocomplete="email" />
        </div>
        <div class="field">
          <label for="pk-notes">Observações (opcional)</label>
          <textarea id="pk-notes" name="notes" placeholder="Alguma preferência?"></textarea>
        </div>
      </div>
      <div class="booking-summary" id="summary" style="margin-top:16px"></div>
      <button class="btn btn-primary btn-block" id="pk-confirm" type="button" style="margin-top:16px">
        ${icon('check')} Confirmar agendamento
      </button>
      <p class="faint" style="margin-top:10px;font-size:11.5px;text-align:center">
        Ao confirmar, seu horário fica reservado e aguarda a confirmação da barbearia.
      </p>
    </div>`;
}

/* ------------------------------ Disponibilidade --------------------------- */

async function loadDays() {
  const from = todayISO();
  const to = addDays(from, daysLimit());
  const days = await api.get(
    `/api/public/calendar${query({ barber_id: state.barberId, service_id: state.serviceId, from, to })}`
  );
  state.days = days.filter((day) => day.open);
  if (!state.days.some((day) => day.date === state.date)) {
    state.date = state.days.length ? state.days[0].date : null;
  }
}

async function loadSlots() {
  if (!state.date) {
    state.slots = [];
    state.slotsReason = 'Nenhum dia disponível no momento.';
    return;
  }
  const result = await api.get(
    `/api/public/availability${query({
      barber_id: state.barberId,
      service_id: state.serviceId,
      date: state.date,
    })}`
  );
  state.slots = result.slots || [];
  state.slotsReason = result.open ? 'Todos os horários deste dia já foram preenchidos.' : result.reason || '';
  if (!state.slots.includes(state.time)) state.time = null;
}

/* --------------------------------- Render --------------------------------- */

function renderServices() {
  const grid = document.getElementById('service-grid');
  grid.innerHTML = state.services
    .map(
      (service) => `
      <button type="button" class="choice service-choice${String(state.serviceId) === String(service.id) ? ' selected' : ''}" data-service="${service.id}">
        <div class="choice-head">
          <strong>${esc(service.name)}</strong>
          <span class="choice-price">${esc(money(service.price))}</span>
        </div>
        <div class="choice-meta">
          <span class="choice-duration">${icon('clock')} ${Number(service.duration_min)} min</span>
        </div>
        ${service.description ? `<p class="choice-desc">${esc(service.description)}</p>` : ''}
      </button>`
    )
    .join('');

  grid.querySelectorAll('[data-service]').forEach((element) =>
    element.addEventListener('click', async () => {
      state.serviceId = Number(element.dataset.service);
      state.time = null;
      renderServices();
      revealSection('sec-barber');
      renderBarbers();
      await bootstrapDateSection();
      setStep(currentStep());
    })
  );
}

function renderBarbers() {
  const grid = document.getElementById('barber-grid');
  grid.innerHTML = state.barbers
    .map(
      (barber) => `
      <button type="button" class="choice barber-choice${String(state.barberId) === String(barber.id) ? ' selected' : ''}" data-barber="${barber.id}">
        <div class="barber-avatar" style="border-color:${esc(barber.color || 'var(--gold)')};color:${esc(barber.color || 'var(--gold)')}">
          ${esc(initials(barber.name))}
        </div>
        <div class="barber-meta">
          <strong>${esc(barber.name)}</strong>
          <span class="barber-spec">Barbeiro Especialista</span>
        </div>
      </button>`
    )
    .join('');

  grid.querySelectorAll('[data-barber]').forEach((element) =>
    element.addEventListener('click', async () => {
      state.barberId = Number(element.dataset.barber);
      state.time = null;
      renderBarbers();
      await bootstrapDateSection();
      setStep(currentStep());
    })
  );
}

function renderDays() {
  const strip = document.getElementById('day-strip');
  if (!state.days.length) {
    strip.innerHTML = '<span class="muted">Nenhum dia com horário livre nos próximos dias.</span>';
    return;
  }
  strip.innerHTML = state.days
    .map((day) => {
      const date = parseISO(day.date);
      return `
        <button type="button" class="day-chip${day.date === state.date ? ' selected' : ''}" data-day="${day.date}">
          <span>${esc(WEEKDAYS_SHORT[date.getDay()])}</span>
          <strong>${String(date.getDate()).padStart(2, '0')}</strong>
        </button>`;
    })
    .join('');

  strip.querySelectorAll('[data-day]').forEach((element) =>
    element.addEventListener('click', async () => {
      state.date = element.dataset.day;
      state.time = null;
      renderDays();
      await refreshSlots();
      setStep(currentStep());
    })
  );
}

function renderSlots() {
  const area = document.getElementById('slot-area');
  if (!state.slots.length) {
    area.innerHTML = `<div class="empty">${esc(state.slotsReason || 'Nenhum horário livre neste dia.')}</div>`;
    return;
  }
  area.innerHTML = `
    <p class="section-title">Horários livres</p>
    <div class="slot-grid">
      ${state.slots
        .map(
          (slot) =>
            `<button type="button" class="slot${slot === state.time ? ' selected' : ''}" data-slot="${slot}">${esc(slot)}</button>`
        )
        .join('')}
    </div>`;

  area.querySelectorAll('[data-slot]').forEach((element) =>
    element.addEventListener('click', () => {
      state.time = element.dataset.slot;
      renderSlots();
      revealSection('sec-form');
      renderSummary();
      setStep(4);
    })
  );
}

function renderSummary() {
  const service = state.services.find((item) => Number(item.id) === Number(state.serviceId));
  const barber = state.barbers.find((item) => Number(item.id) === Number(state.barberId));
  document.getElementById('summary').innerHTML = `
    <div><span>Serviço</span><strong>${esc(service?.name || '-')}</strong></div>
    <div><span>Profissional</span><strong>${esc(barber?.name || '-')}</strong></div>
    <div><span>Data</span><strong>${esc(state.date ? formatDateBR(state.date) : '-')}</strong></div>
    <div><span>Horário</span><strong>${esc(state.time || '-')}</strong></div>
    <div><span>Valor</span><strong>${esc(service ? money(service.price) : '-')}</strong></div>`;
}

async function refreshSlots() {
  const area = document.getElementById('slot-area');
  area.innerHTML = '<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>Buscando horários...</div>';
  try {
    await loadSlots();
    renderSlots();
  } catch (error) {
    state.slots = [];
    state.slotsReason = error.message;
    renderSlots();
  }
  renderSummary();
}

async function bootstrapDateSection() {
  document.getElementById('sec-date').classList.remove('hidden');
  const area = document.getElementById('slot-area');
  area.innerHTML = '<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>Buscando horários...</div>';
  try {
    await loadDays();
    renderDays();
    await loadSlots();
    renderSlots();
  } catch (error) {
    document.getElementById('day-strip').innerHTML = '';
    state.slots = [];
    state.slotsReason = error.message;
    renderSlots();
  }
  renderSummary();
}

/* -------------------------------- Confirmação ------------------------------ */

function successHtml(result) {
  const appointment = result.appointment;
  const service = state.services.find((item) => Number(item.id) === Number(state.serviceId));
  const fullManageUrl = result.manage_url
    ? `${window.location.origin}${result.manage_url}`
    : '';

  return `
    <div class="card success-box">
      <div class="success-check">${icon('check')}</div>
      <h3>Horário reservado com sucesso!</h3>
      <p class="muted" style="text-align:center">
        Seu horário está confirmado na barbearia. Chegue 5 minutinhos antes para tomar um café e relaxar.
      </p>
      <div class="booking-summary" style="width:100%;text-align:left">
        <div><span>Cliente</span><strong>${esc(appointment.client_name)}</strong></div>
        <div><span>Serviço</span><strong>${esc(appointment.service_name || service?.name || '-')}</strong></div>
        <div><span>Profissional</span><strong>${esc(appointment.barber_name)}</strong></div>
        <div><span>Data</span><strong>${esc(formatDateBR(appointment.date))}</strong></div>
        <div><span>Horário</span><strong>${esc(appointment.start_time)} às ${esc(appointment.end_time)}</strong></div>
        <div><span>Valor</span><strong>${esc(money(appointment.price))}</strong></div>
      </div>
      ${
        fullManageUrl
          ? `
          <div style="margin-top:16px;padding:12px;background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:10px;text-align:left;width:100%">
            <div style="font-size:12.5px;color:var(--text);display:flex;align-items:center;gap:6px;font-weight:600">
              ${icon('shield-check')} Link de autoatendimento
            </div>
            <p class="muted" style="margin-top:4px;font-size:12px">
              Guarde este link para consultar ou cancelar seu agendamento a qualquer momento:
            </p>
            <div style="margin-top:8px;display:flex;gap:6px">
              <input type="text" readonly value="${esc(fullManageUrl)}" id="pk-manage-link" style="font-size:11.5px;padding:6px 10px;flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px" />
              <button class="btn btn-sm" id="pk-copy-manage" type="button">${icon('clipboard')} Copiar</button>
            </div>
          </div>`
          : ''
      }
      ${
        result.confirmation?.whatsapp_automated
          ? `<div style="margin-top:14px;padding:12px;background:rgba(16, 185, 129, 0.12);border:1px solid rgba(16, 185, 129, 0.3);border-radius:10px;color:#34d399;font-size:13px;display:flex;align-items:center;gap:8px;text-align:left;width:100%">
               ${icon('check')} <span><strong>WhatsApp Oficial Enviado:</strong> A confirmação foi enviada automaticamente para o seu número.</span>
             </div>`
          : (state.shop?.whatsapp || state.shop?.phone)
          ? `<a class="btn btn-whats btn-block" href="https://wa.me/55${esc(String(state.shop.whatsapp || state.shop.phone).replace(/\D/g, ''))}?text=${encodeURIComponent('Olá! Acabei de fazer um agendamento pelo site.')}" target="_blank" rel="noopener">
               ${icon('whatsapp')} Falar com a barbearia no WhatsApp
             </a>`
          : ''
      }
      <button class="btn btn-ghost btn-block" id="pk-again" type="button">Fazer outro agendamento</button>
    </div>`;
}

function renderManageAppointment(token, appt) {
  const canCancel = appt.status === 'pending' || appt.status === 'confirmed';

  content().innerHTML = `
    <div class="card" style="max-width:540px;margin:0 auto">
      <div class="card-header" style="align-items:center;justify-content:space-between">
        <div>
          <h3>Detalhes do seu agendamento</h3>
          <div class="card-sub">Código #${appt.id}</div>
        </div>
        <div>${statusPill(appt.status)}</div>
      </div>

      <div class="booking-summary" style="margin-top:16px;text-align:left">
        <div><span>Cliente</span><strong>${esc(appt.client_name)}</strong></div>
        <div><span>Serviço</span><strong>${esc(appt.service_name || '-')}</strong></div>
        <div><span>Profissional</span><strong>${esc(appt.barber_name)}</strong></div>
        <div><span>Data</span><strong>${esc(formatDateBR(appt.date))}</strong></div>
        <div><span>Horário</span><strong>${esc(appt.start_time)} às ${esc(appt.end_time)}</strong></div>
        <div><span>Valor</span><strong>${esc(money(appt.price))}</strong></div>
        ${appt.notes ? `<div><span>Observações</span><span style="font-size:12.5px">${esc(appt.notes)}</span></div>` : ''}
        ${appt.cancellation_reason ? `<div><span>Cancelamento</span><span class="danger" style="font-size:12.5px">${esc(appt.cancellation_reason)}</span></div>` : ''}
      </div>

      ${
        canCancel
          ? `
        <div id="cancel-section" style="margin-top:24px;padding-top:16px;border-top:1px solid var(--c-border)">
          <h4 style="font-size:14px">Precisa cancelar este horário?</h4>
          <p class="muted" style="font-size:12.5px;margin-top:4px">
            Ao cancelar, o horário ficará livre para outro cliente.
          </p>
          <div class="field" style="margin-top:12px">
            <label for="pk-cancel-reason">Motivo do cancelamento (opcional)</label>
            <input id="pk-cancel-reason" placeholder="Ex.: Tive um imprevisto" maxlength="200" />
          </div>
          <button class="btn btn-danger btn-block" id="btn-do-cancel" type="button" style="margin-top:12px">
            ${icon('ban')} Cancelar meu agendamento
          </button>
        </div>`
          : ''
      }

      <div class="row-actions" style="margin-top:20px;justify-content:center">
        <a class="btn btn-ghost btn-block" href="/agendar">Fazer novo agendamento</a>
      </div>
    </div>`;

  if (canCancel) {
    const cancelBtn = document.getElementById('btn-do-cancel');
    cancelBtn?.addEventListener('click', async () => {
      const reasonInput = document.getElementById('pk-cancel-reason');
      const reason = reasonInput ? reasonInput.value.trim() : '';

      if (!confirm('Deseja realmente cancelar este agendamento?')) {
        return;
      }

      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelando...';

      try {
        const updated = await api.post(`/api/public/appointments/${encodeURIComponent(token)}/cancel`, { reason });
        toast('Agendamento cancelado com sucesso.', 'success');
        renderManageAppointment(token, updated.appointment);
      } catch (err) {
        toast(err.message, 'error');
        cancelBtn.disabled = false;
        cancelBtn.innerHTML = `${icon('ban')} Cancelar meu agendamento`;
      }
    });
  }
}

async function bootManage(token) {
  const steps = document.getElementById('steps');
  if (steps) steps.classList.add('hidden');
  content().innerHTML = '<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>Buscando agendamento...</div>';

  try {
    const config = await api.get('/api/public/config');
    applyShop(config);

    const appt = await api.get(`/api/public/appointments/${encodeURIComponent(token)}`);
    renderManageAppointment(token, appt);
  } catch (error) {
    content().innerHTML = `
      <div class="card empty-state" style="margin:0 auto">
        <div class="kpi-icon" style="position:static;margin:0 auto 16px;color:var(--c-danger)">${icon('ban')}</div>
        <h3>Agendamento não encontrado</h3>
        <p class="muted" style="margin-top:8px">${esc(error.message || 'O link pode ser inválido ou expirado.')}</p>
        <div class="row-actions" style="justify-content:center;margin-top:20px">
          <a class="btn btn-primary" href="/agendar">${icon('calendar')} Fazer um agendamento</a>
        </div>
      </div>`;
  }
}

async function submit() {
  const name = document.getElementById('pk-name').value.trim();
  const phone = document.getElementById('pk-phone').value.trim();
  const email = document.getElementById('pk-email').value.trim();
  const notes = document.getElementById('pk-notes').value.trim();

  if (!name) return toast('Informe seu nome.', 'error');
  if (phone.replace(/\D/g, '').length < 10) return toast('Informe um WhatsApp com DDD.', 'error');
  if (!state.serviceId || !state.barberId || !state.date || !state.time) {
    return toast('Escolha serviço, profissional, dia e horário.', 'error');
  }

  const submitButton = document.getElementById('pk-confirm');
  submitButton.disabled = true;
  submitButton.textContent = 'Enviando...';

  try {
    const result = await api.post('/api/public/appointments', {
      name,
      phone,
      email,
      notes,
      barber_id: state.barberId,
      service_id: state.serviceId,
      date: state.date,
      start_time: state.time,
    });
    content().innerHTML = successHtml(result);
    setStep(4);

    document.getElementById('pk-copy-manage')?.addEventListener('click', async () => {
      const input = document.getElementById('pk-manage-link');
      if (input) {
        input.select();
        await navigator.clipboard.writeText(input.value).catch(() => {});
        toast('Link copiado para a área de transferência!', 'success');
      }
    });

    document.getElementById('pk-again')?.addEventListener('click', () => window.location.reload());
  } catch (error) {
    toast(error.message, 'error');
    submitButton.disabled = false;
    submitButton.textContent = 'Confirmar agendamento';
    if (error.status === 409) {
      await refreshSlots();
      document.getElementById('sec-form').classList.add('hidden');
      setStep(currentStep());
    }
  }
}

/* ---------------------------------- Boot ---------------------------------- */

function unavailableHtml(message, extra = '') {
  const whatsapp = state.shop?.whatsapp || state.shop?.phone;
  return `
    <div class="card empty-state" style="margin:0 auto">
      <div class="brand-mark">GB</div>
      <h3>${esc(message)}</h3>
      <p class="muted">${esc(extra)}</p>
      <div class="row-actions" style="justify-content:center">
        ${
          whatsapp
            ? `<a class="btn btn-whats" href="https://wa.me/55${esc(String(whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">${icon('whatsapp')} Falar no WhatsApp</a>`
            : ''
        }
      </div>
    </div>`;
}

function whatsappLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
}

function applyShop(config) {
  state.shop = config.shop;
  state.services = config.services;
  state.barbers = config.barbers;
  document.title = `Agendar horário | ${config.shop.name}`;
  document.getElementById('shop-name').textContent = config.shop.name;
  const company = (config.shop.company && config.shop.company !== 'Nova Runtime')
    ? config.shop.company
    : 'Cortes & Barba Tradicional';
  document.getElementById('shop-company').textContent = company;
  document.getElementById('shop-sub').textContent = config.shop.address
    ? config.shop.address
    : 'Escolha o serviço, o profissional e o melhor horário.';

  const links = [];
  const whatsapp = whatsappLink(config.shop.whatsapp || config.shop.phone);
  if (whatsapp) {
    links.push(
      `<a class="btn btn-sm btn-whats" href="${esc(whatsapp)}" target="_blank" rel="noopener">${icon('whatsapp')} Falar no WhatsApp</a>`
    );
  }
  if (config.shop.phone) {
    links.push(
      `<a class="btn btn-sm" href="tel:${esc(String(config.shop.phone).replace(/[^\d+]/g, ''))}">${icon('phone')} Ligar</a>`
    );
  }
  if (config.shop.instagram) {
    const handle = String(config.shop.instagram).replace(/^@/, '');
    links.push(
      `<a class="btn btn-sm" href="https://instagram.com/${esc(encodeURIComponent(handle))}" target="_blank" rel="noopener">${icon('link')} @${esc(handle)}</a>`
    );
  }
  document.getElementById('shop-contact').innerHTML = links.join('');

  const demoBadge = document.getElementById('demo-badge');
  if (demoBadge) demoBadge.classList.toggle('hidden', !config.shop.demo);
}

async function boot() {
  try {
    const params = new URLSearchParams(window.location.search);
    const manageToken = params.get('manage') || params.get('cancel') || params.get('token');
    if (manageToken) {
      return await bootManage(manageToken);
    }

    const config = await api.get('/api/public/config');
    applyShop(config);

    if (!config.shop.public_booking) {
      content().innerHTML = unavailableHtml(
        'O agendamento online está temporariamente desativado',
        'Fale diretamente com a barbearia para reservar seu horário.'
      );
      document.getElementById('steps').classList.add('hidden');
      return;
    }
    if (!config.services.length || !config.barbers.length) {
      content().innerHTML = unavailableHtml(
        'A agenda ainda está sendo configurada',
        'Assim que os serviços e profissionais forem cadastrados, o agendamento online ficará disponível.'
      );
      document.getElementById('steps').classList.add('hidden');
      return;
    }

    content().innerHTML = skeletonHtml();
    renderServices();
    document.getElementById('pk-confirm').addEventListener('click', submit);
    document.getElementById('pk-phone').addEventListener('blur', (event) => {
      event.target.value = formatPhone(event.target.value);
    });
    setStep(1);
  } catch (error) {
    content().innerHTML = unavailableHtml('Não foi possível carregar a agenda', error.message);
    document.getElementById('steps').classList.add('hidden');
  }
}

boot();
