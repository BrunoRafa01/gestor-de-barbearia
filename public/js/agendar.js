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
  reviews: [],
  currentTab: 'booking',
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

function haptic(ms = 12) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(ms); } catch {}
  }
}

/* --------------------------------- Passos --------------------------------- */

const STEP_LABELS = {
  1: 'Passo 1 de 4 — Escolha o serviço',
  2: 'Passo 2 de 4 — Escolha o profissional',
  3: 'Passo 3 de 4 — Escolha o dia e horário',
  4: 'Passo 4 de 4 — Confirme seus dados',
};

function setStep(active) {
  document.querySelectorAll('#steps span, .progress-bar-seg').forEach((element) => {
    element.classList.toggle('active', Number(element.dataset.step) <= active);
  });
  const label = document.getElementById('current-step-label');
  if (label && STEP_LABELS[active]) {
    label.textContent = STEP_LABELS[active];
  }
  const indicator = document.getElementById('step-indicator');
  if (indicator) {
    indicator.textContent = `${active} / 4`;
  }
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
    <div class="card booking-card" id="sec-service">
      <div class="card-section-head">
        <div>
          <h3>Serviços disponíveis</h3>
          <p class="section-sub">Selecione o corte ou procedimento desejado</p>
        </div>
      </div>
      <div class="choice-list" id="service-grid"></div>
    </div>

    <div class="card booking-card hidden" id="sec-barber">
      <div class="card-section-head">
        <div>
          <h3>Profissional</h3>
          <p class="section-sub">Com qual barbeiro você deseja agendar?</p>
        </div>
      </div>
      <div class="choice-list" id="barber-grid"></div>
    </div>

    <div class="card booking-card hidden" id="sec-date">
      <div class="card-section-head">
        <div>
          <h3>Dia e horário</h3>
          <p class="section-sub">Horários livres atualizados em tempo real</p>
        </div>
      </div>
      <div class="day-strip" id="day-strip"></div>
      <div id="slot-area" style="margin-top:20px"></div>
    </div>

    <div class="card booking-card hidden" id="sec-form">
      <div class="card-section-head">
        <div>
          <h3>Seus dados</h3>
          <p class="section-sub">Enviaremos a confirmação direta no seu WhatsApp</p>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr;gap:14px">
        <div class="field">
          <label for="pk-name">Seu nome completo</label>
          <input id="pk-name" name="name" placeholder="Ex: João Silva" autocomplete="name" />
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
          <textarea id="pk-notes" name="notes" placeholder="Alguma preferência ou detalhe para o barbeiro?"></textarea>
        </div>
      </div>
      <div class="booking-summary" id="summary" style="margin-top:20px"></div>
      <button class="btn btn-primary btn-block" id="pk-confirm" type="button" style="margin-top:20px">
        ${icon('check')} Confirmar agendamento
      </button>
      <p class="faint" style="margin-top:12px;font-size:12px;text-align:center">
        🔒 Reserva pontual e segura. Sem cobrança antecipada.
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
        <div class="service-left">
          <div class="service-title-row">
            <strong class="service-name">${esc(service.name)}</strong>
            <span class="service-duration-badge">${icon('clock')} ${Number(service.duration_min)} min</span>
          </div>
          ${service.description ? `<p class="service-desc">${esc(service.description)}</p>` : ''}
        </div>
        <div class="service-right">
          <span class="service-price">${esc(money(service.price))}</span>
          <div class="selection-pill" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>
          </div>
        </div>
      </button>`
    )
    .join('');

  grid.querySelectorAll('[data-service]').forEach((element) =>
    element.addEventListener('click', async () => {
      haptic();
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
  const isAnySelected = state.isAnyBarber;

  const anyCard = `
    <button type="button" class="choice barber-choice${isAnySelected ? ' selected' : ''}" data-barber="any">
      <div class="barber-avatar-box" style="background:var(--primary);color:#FFFFFF;font-size:18px">
        ⚡
      </div>
      <div class="barber-meta">
        <strong class="barber-name">Qualquer profissional disponível</strong>
        <span class="barber-spec">Maior agilidade • Primeiro horário livre na agenda</span>
      </div>
      <div class="selection-pill" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>
      </div>
    </button>
  `;

  const barbersList = state.barbers
    .map(
      (barber) => `
      <button type="button" class="choice barber-choice${!isAnySelected && String(state.barberId) === String(barber.id) ? ' selected' : ''}" data-barber="${barber.id}">
        <div class="barber-avatar-box">
          ${esc(initials(barber.name))}
        </div>
        <div class="barber-meta">
          <strong class="barber-name">${esc(barber.name)}</strong>
          <span class="barber-spec">${esc(barber.specialties || 'Mestre Barbeiro')}</span>
          <div style="font-size:11px;color:#F59E0B;margin-top:2px;display:flex;align-items:center;gap:4px">
            <span>★ ${Number(barber.rating || 4.9).toFixed(1)}</span>
            <span style="color:var(--text-dim)">• Verificado</span>
          </div>
        </div>
        <div class="selection-pill" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>
        </div>
      </button>`
    )
    .join('');

  grid.innerHTML = anyCard + barbersList;

  grid.querySelectorAll('[data-barber]').forEach((element) =>
    element.addEventListener('click', async () => {
      haptic();
      const val = element.dataset.barber;
      if (val === 'any') {
        state.isAnyBarber = true;
        state.barberId = state.barbers.length ? state.barbers[0].id : null;
      } else {
        state.isAnyBarber = false;
        state.barberId = Number(val);
      }
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
      haptic();
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
      haptic();
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
        appointment.cancel_token
          ? `
          <div style="margin-top:14px;width:100%">
            <a class="btn-calendar-add" href="/api/public/ics/${esc(appointment.cancel_token)}" download="agendamento-${esc(appointment.date)}.ics">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Adicionar ao Calendário (Apple / Google)
            </a>
          </div>`
          : ''
      }
      ${
        fullManageUrl
          ? `
          <div style="margin-top:14px;padding:12px;background:var(--primary-soft);border:1px solid var(--border);border-radius:10px;text-align:left;width:100%">
            <div style="font-size:12.5px;color:var(--text);display:flex;align-items:center;gap:6px;font-weight:600">
              ${icon('shield-check')} Link de autoatendimento
            </div>
            <p class="muted" style="margin-top:4px;font-size:12px">
              Guarde este link para consultar, reagendar ou cancelar seu horário a qualquer momento:
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
  state.reviews = config.reviews || [];

  document.title = `Agendar horário | ${config.shop.name}`;
  document.getElementById('shop-name').textContent = config.shop.name;
  const company = (config.shop.company && config.shop.company !== 'Nova Runtime')
    ? config.shop.company
    : 'Nova Runtime SaaS';
  document.getElementById('shop-company').textContent = company;

  const heroNameEl = document.getElementById('shop-hero-name');
  if (heroNameEl) heroNameEl.textContent = config.shop.name;

  const bioEl = document.getElementById('shop-bio');
  if (bioEl) {
    bioEl.textContent = config.shop.description || 'Ambiente exclusivo, cortes de alta precisão e atendimento personalizado.';
  }

  // Botoes de acao rapida no cabecalho
  const quickActions = document.getElementById('shop-actions');
  if (quickActions) {
    const actionBtns = [];
    const whatsapp = whatsappLink(config.shop.whatsapp || config.shop.phone);
    if (whatsapp) {
      actionBtns.push(
        `<a class="shop-action-btn whats" href="${esc(whatsapp)}?text=${encodeURIComponent('Olá! Gostaria de informações sobre a barbearia.')}" target="_blank" rel="noopener">
          ${icon('whatsapp')} Conversar no WhatsApp
        </a>`
      );
    }
    if (config.shop.instagram) {
      const handle = String(config.shop.instagram).replace(/^@/, '');
      actionBtns.push(
        `<a class="shop-action-btn insta" href="https://instagram.com/${esc(encodeURIComponent(handle))}" target="_blank" rel="noopener">
          ${icon('link')} @${esc(handle)}
        </a>`
      );
    }
    if (config.shop.address) {
      actionBtns.push(
        `<a class="shop-action-btn address" href="https://maps.google.com/?q=${encodeURIComponent(config.shop.address)}" target="_blank" rel="noopener">
          ${icon('calendar')} Como Chegar
        </a>`
      );
    }
    quickActions.innerHTML = actionBtns.join('');
  }

  const links = [];
  const whatsapp = whatsappLink(config.shop.whatsapp || config.shop.phone);
  if (whatsapp) {
    links.push(
      `<a class="footer-contact-link whats" href="${esc(whatsapp)}" target="_blank" rel="noopener">${icon('whatsapp')} <span>WhatsApp</span></a>`
    );
  }
  if (config.shop.phone) {
    links.push(
      `<a class="footer-contact-link" href="tel:${esc(String(config.shop.phone).replace(/[^\d+]/g, ''))}">${icon('phone')} <span>${esc(config.shop.phone)}</span></a>`
    );
  }
  if (config.shop.instagram) {
    const handle = String(config.shop.instagram).replace(/^@/, '');
    links.push(
      `<a class="footer-contact-link insta" href="https://instagram.com/${esc(encodeURIComponent(handle))}" target="_blank" rel="noopener">${icon('link')} <span>@${esc(handle)}</span></a>`
    );
  }
  const contactEl = document.getElementById('shop-contact');
  if (contactEl) contactEl.innerHTML = links.join('');

  const demoBadge = document.getElementById('demo-badge');
  if (demoBadge) demoBadge.classList.toggle('hidden', !config.shop.demo);
}

function renderBookingTab() {
  content().innerHTML = skeletonHtml();
  renderServices();
  if (state.serviceId) {
    revealSection('sec-barber');
    renderBarbers();
  }
  if (state.barberId) {
    revealSection('sec-date');
    renderDays();
    renderSlots();
  }
  if (state.date && state.time) {
    revealSection('sec-form');
    renderSummary();
  }
  document.getElementById('pk-confirm')?.addEventListener('click', submit);
  document.getElementById('pk-phone')?.addEventListener('blur', (event) => {
    event.target.value = formatPhone(event.target.value);
  });
  setStep(currentStep());
}

function renderCutsTab() {
  const cuts = state.shop?.cuts_gallery || [];
  content().innerHTML = `
    <div class="card booking-card">
      <div class="card-section-head">
        <div>
          <h3>Galeria de Estilos e Cortes</h3>
          <p class="section-sub">Trabalhos executados pelos nossos mestres barbeiros</p>
        </div>
      </div>
      <div class="cuts-grid">
        ${cuts
          .map(
            (cut) => `
          <div class="cut-card">
            <div class="cut-thumb-placeholder">
              <span class="cut-thumb-tag">${esc(cut.tag || 'Corte')}</span>
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/>
                <line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
            </div>
            <div class="cut-card-body">
              <h4 class="cut-card-title">${esc(cut.title)}</h4>
              <p class="cut-card-desc">${esc(cut.desc)}</p>
              <button type="button" class="btn btn-sm btn-block btn-primary" style="margin-top:10px" data-action="pick-cut">
                Quero Este Estilo
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>`;

  content().querySelectorAll('[data-action="pick-cut"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector('[data-tab="booking"]')?.click();
    });
  });
}

function renderTeamTab() {
  content().innerHTML = `
    <div class="card booking-card">
      <div class="card-section-head">
        <div>
          <h3>Nossa Equipe de Barbeiros</h3>
          <p class="section-sub">Especialistas comprometidos com excelência e pontualidade</p>
        </div>
      </div>
      <div class="team-list">
        ${state.barbers
          .map(
            (barber) => `
          <div class="barber-rich-card">
            <div class="barber-rich-avatar">
              ${esc(initials(barber.name))}
            </div>
            <div class="barber-rich-info">
              <div class="barber-rich-name-row">
                <strong style="color:var(--text);font-size:15px">${esc(barber.name)}</strong>
                <span class="rating-pill">★ ${Number(barber.rating || 4.9).toFixed(1)}</span>
              </div>
              <span class="barber-rich-spec">${esc(barber.specialties || 'Mestre Barbeiro')}</span>
              <p class="barber-rich-bio">${esc(barber.bio || 'Especialista em visagismo, corte masculino e barba alinhada.')}</p>
              <button type="button" class="btn btn-sm btn-ghost" style="margin-top:8px" data-barber-pick="${barber.id}">
                Agendar com ${esc(barber.name.split(' ')[0])} &rarr;
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>`;

  content().querySelectorAll('[data-barber-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.barberId = Number(btn.dataset.barberPick);
      state.isAnyBarber = false;
      document.querySelector('[data-tab="booking"]')?.click();
    });
  });
}

function renderReviewsTab() {
  const reviews = state.reviews || [];
  content().innerHTML = `
    <div class="card booking-card">
      <div class="card-section-head" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <h3>Avaliações Verificadas</h3>
          <p class="section-sub">Opinião autêntica de clientes atendidos no estabelecimento</p>
        </div>
        <div class="rating-pill" style="font-size:13px;padding:4px 10px">
          ★ 4.9 • Excelente
        </div>
      </div>
      <div class="reviews-grid">
        ${
          reviews.length
            ? reviews
                .map(
                  (rev) => `
            <div class="review-item-card">
              <div class="review-head">
                <div class="review-client">
                  <strong>${esc(rev.client_name)}</strong>
                  <span class="review-verified-pill">✓ Atendido</span>
                </div>
                <div class="review-stars">${'★'.repeat(Math.max(1, Math.min(5, rev.rating)))}</div>
              </div>
              <p class="review-comment">"${esc(rev.comment || 'Atendimento impecável!')}"</p>
            </div>`
                )
                .join('')
            : '<div class="empty">Nenhuma avaliação cadastrada ainda.</div>'
        }
      </div>
      <div style="margin-top:20px;text-align:center">
        <button type="button" class="btn btn-primary" id="btn-open-review">
          Deixar Minha Avaliação
        </button>
      </div>
    </div>`;

  document.getElementById('btn-open-review')?.addEventListener('click', () => {
    const clientName = prompt('Qual é o seu nome?');
    if (!clientName) return;
    const comment = prompt('Conte como foi sua experiência:');
    if (!comment) return;
    api.post('/api/public/reviews', {
      shop_slug: state.shop?.slug || 'nova-barbearia',
      client_name: clientName,
      rating: 5,
      comment,
    })
      .then(() => {
        toast('Avaliação enviada com sucesso! Obrigado pelo feedback.', 'success');
        state.reviews.unshift({ client_name: clientName, rating: 5, comment });
        renderReviewsTab();
      })
      .catch((err) => toast(err.message, 'error'));
  });
}

function setupTabs() {
  document.querySelectorAll('.shop-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic();
      document.querySelectorAll('.shop-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      state.currentTab = tab;
      if (tab === 'booking') {
        document.getElementById('progress-container')?.classList.remove('hidden');
        renderBookingTab();
      } else if (tab === 'cuts') {
        document.getElementById('progress-container')?.classList.add('hidden');
        renderCutsTab();
      } else if (tab === 'team') {
        document.getElementById('progress-container')?.classList.add('hidden');
        renderTeamTab();
      } else if (tab === 'reviews') {
        document.getElementById('progress-container')?.classList.add('hidden');
        renderReviewsTab();
      }
    });
  });
}

function setupAppInstallation() {
  const installBtn = document.getElementById('pwa-install-btn');
  const iosModal = document.getElementById('ios-install-modal');
  const closeBtn = document.getElementById('close-ios-modal');
  const dismissBtn = document.getElementById('dismiss-ios-modal');

  // Se já estiver rodando como app standalone instalado
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone && installBtn) {
    installBtn.classList.add('hidden');
    return;
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      haptic();
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          installBtn.classList.add('hidden');
        }
        deferredPrompt = null;
        return;
      }
      // Se estiver no iOS Safari ou navegador mobile sem prompt nativo
      if (iosModal) {
        iosModal.classList.remove('hidden');
      }
    });
  }

  const closeModal = () => {
    if (iosModal) iosModal.classList.add('hidden');
  };
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
  if (iosModal) {
    iosModal.addEventListener('click', (e) => {
      if (e.target === iosModal) closeModal();
    });
  }
}

async function boot() {
  try {
    const params = new URLSearchParams(window.location.search);
    const manageToken = params.get('manage') || params.get('cancel') || params.get('token');
    if (manageToken) {
      return await bootManage(manageToken);
    }

    // Identifica o estabelecimento / barbearia ativa (multi-tenant)
    let shopSlug = params.get('shop') || '';
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'b' && pathParts[1]) {
      shopSlug = pathParts[1];
    }

    const config = await api.get(`/api/public/config${query({ shop: shopSlug || 'nova-barbearia' })}`);
    applyShop(config);
    setupTabs();

    if (!config.shop.public_booking) {
      content().innerHTML = unavailableHtml(
        'O agendamento online está temporariamente desativado',
        'Fale diretamente com a barbearia para reservar seu horário.'
      );
      document.getElementById('progress-container')?.classList.add('hidden');
      document.getElementById('steps')?.classList.add('hidden');
      return;
    }
    if (!config.services.length || !config.barbers.length) {
      content().innerHTML = unavailableHtml(
        'A agenda ainda está sendo configurada',
        'Assim que os serviços e profissionais forem cadastrados, o agendamento online ficará disponível.'
      );
      document.getElementById('progress-container')?.classList.add('hidden');
      document.getElementById('steps')?.classList.add('hidden');
      return;
    }

    content().innerHTML = skeletonHtml();
    renderServices();
    document.getElementById('pk-confirm').addEventListener('click', submit);
    document.getElementById('pk-phone').addEventListener('blur', (event) => {
      event.target.value = formatPhone(event.target.value);
    });
    setStep(1);
    setupAppInstallation();
  } catch (error) {
    content().innerHTML = unavailableHtml('Não foi possível carregar a agenda', error.message);
    document.getElementById('progress-container')?.classList.add('hidden');
    document.getElementById('steps')?.classList.add('hidden');
  }
}

boot();
