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
  money,
  parseISO,
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
      <button type="button" class="choice${String(state.serviceId) === String(service.id) ? ' selected' : ''}" data-service="${service.id}">
        <strong>${esc(service.name)}</strong>
        <span>${Number(service.duration_min)} min - ${esc(money(service.price))}</span>
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
      <button type="button" class="choice${String(state.barberId) === String(barber.id) ? ' selected' : ''}" data-barber="${barber.id}">
        <strong>${esc(barber.name)}</strong>
        <span>Profissional</span>
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
  return `
    <div class="card success-box">
      <div class="success-check">${icon('check')}</div>
      <h3>Agendamento enviado!</h3>
      <p class="muted" style="text-align:center">
        Seu horário foi reservado e aguarda a confirmação da barbearia.
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
        result.confirmation?.link
          ? `<a class="btn btn-whats btn-block" href="${esc(result.confirmation.link)}" target="_blank" rel="noopener">
               ${icon('whatsapp')} Enviar confirmação no WhatsApp
             </a>`
          : ''
      }
      <button class="btn btn-ghost btn-block" id="pk-again" type="button">Fazer outro agendamento</button>
    </div>`;
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
    document.getElementById('pk-again')?.addEventListener('click', () => window.location.reload());
    if (result.confirmation?.link) window.open(result.confirmation.link, '_blank', 'noopener');
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
  document.getElementById('shop-company').textContent = config.shop.company || 'Nova Runtime';
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
