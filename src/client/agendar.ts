/**
 * Página pública de agendamento (mobile-first) do Gestor de Barbearia — NOVA RUNTIME
 * Fluxo em 6 etapas: 1. Serviço → 2. Profissional → 3. Data → 4. Horário → 5. Dados do cliente → 6. Confirmação
 * + Abas Portfólio, Equipe e Avaliações + Autoatendimento (?manage=) + Lenis Smooth Scroll + Lottie.
 */

import {
  animateBookingBoot,
  animateBookingSectionReveal,
  animateBookingSuccess,
  animateDayStrip,
  animateLookbookCards,
  animateServicesList,
  animateSlotsGrid,
  animateStickyBarPrice,
  initGsapMotion,
} from '../animations/index.js';
import { initPublicSmoothScroll } from '../animations/smooth-scroll.js';
import { api, errorMessage, errorStatus, query } from './api.js';
import type {
  Appointment,
  AvailabilityResponse,
  Barber,
  BusinessHours,
  Closure,
  CutGalleryItem,
  PublicBookingResponse,
  PublicCalendarDay,
  PublicConfigResponse,
  PublicShopInfo,
  Service,
  ShopReview,
} from './types.js';
import {
  addDays,
  confirmDialog,
  esc,
  formatDateBR,
  formatPhone,
  hhmmToMinutes,
  hydrateLottieElements,
  icon,
  money,
  novaRuntimeSignature,
  nowMinutesAppTz,
  parseISO,
  spinnerBlock,
  statusPill,
  toast,
  todayISO,
  weekdayOfISO,
  WEEKDAYS_SHORT,
} from './ui.js';

type PublicTab = 'booking' | 'cuts' | 'team' | 'reviews';
type ServiceCategory = 'all' | 'cortes' | 'barba' | 'combos';

interface BookingState {
  shop: PublicShopInfo | null;
  services: Service[];
  barbers: Barber[];
  reviews: ShopReview[];
  currentTab: PublicTab;
  serviceSearch: string;
  serviceCategory: ServiceCategory;
  serviceId: number | null;
  barberId: number | null;
  isAnyBarber: boolean;
  date: string | null;
  datePicked: boolean;
  time: string | null;
  confirmed: boolean;
  days: PublicCalendarDay[];
  slots: string[];
  slotBarberMap: Record<string, number>;
  slotsReason: string;
}

const state: BookingState = {
  shop: null,
  services: [],
  barbers: [],
  reviews: [],
  currentTab: 'booking',
  serviceSearch: '',
  serviceCategory: 'all',
  serviceId: null,
  barberId: null,
  isAnyBarber: false,
  date: null,
  datePicked: false,
  time: null,
  confirmed: false,
  days: [],
  slots: [],
  slotBarberMap: {},
  slotsReason: '',
};

function content(): HTMLElement {
  const el = document.getElementById('booking-content');
  if (!el) throw new Error('Elemento #booking-content não encontrado.');
  return el;
}

const daysLimit = (): number => Math.min(Number(state.shop?.max_advance_days) || 30, 30);

function haptic(ms = 12): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* ignorado em navegadores sem suporte */
    }
  }
}

/* --------------------------------- Etapas (1 a 6) ------------------------- */

const STEP_LABELS: Record<number, string> = {
  1: 'Etapa 1 de 6 — Escolha o serviço',
  2: 'Etapa 2 de 6 — Escolha o profissional',
  3: 'Etapa 3 de 6 — Escolha a data',
  4: 'Etapa 4 de 6 — Escolha o horário',
  5: 'Etapa 5 de 6 — Seus dados',
  6: 'Etapa 6 de 6 — Confirmação',
};

function ensureSixProgressSegments(): void {
  const wrap = document.querySelector<HTMLElement>('#progress-container .progress-segments');
  if (!wrap || wrap.dataset.sixReady === '1') return;
  wrap.dataset.sixReady = '1';
  wrap.style.gridTemplateColumns = 'repeat(6, 1fr)';
  wrap.innerHTML = [1, 2, 3, 4, 5, 6]
    .map((n) => `<div class="progress-bar-seg${n === 1 ? ' active' : ''}" data-step="${n}"></div>`)
    .join('');
}

function setStep(active: number): void {
  ensureSixProgressSegments();
  document.querySelectorAll<HTMLElement>('#steps span, .progress-bar-seg').forEach((element) => {
    element.classList.toggle('active', Number(element.dataset.step) <= active);
  });
  const label = document.getElementById('current-step-label');
  const stepText = STEP_LABELS[active];
  if (label && stepText) {
    label.textContent = stepText;
  }
  const indicator = document.getElementById('step-indicator');
  if (indicator) {
    indicator.textContent = `${active} / 6`;
  }
  updateBooksyChrome();
}

function currentStep(): number {
  if (state.confirmed) return 6;
  if (!state.serviceId) return 1;
  if (!state.barberId && !state.isAnyBarber) return 2;
  if (!state.date || !state.datePicked) return 3;
  if (!state.time) return 4;
  return 5;
}

/** Mostra a próxima seção e, no celular, rola suavemente até ela. */
function revealSection(id: string): void {
  const element = document.getElementById(id);
  if (!element || !element.classList.contains('hidden')) return;
  element.classList.remove('hidden');
  animateBookingSectionReveal(element);
  if (window.matchMedia('(max-width: 860px)').matches) {
    window.setTimeout(() => element.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
}

/* ---------------------------------- Layout -------------------------------- */

const WEEKDAY_NAMES_SHORT: readonly string[] = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface HoursGroup {
  label: string;
  value: string;
}

function groupBusinessHours(hours: BusinessHours[] = []): HoursGroup[] {
  if (!Array.isArray(hours) || !hours.length) return [];
  const byDay = new Map<number, BusinessHours>(hours.map((h) => [Number(h.weekday), h]));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: Array<{
    key: string;
    startWd: number;
    endWd: number;
    is_open: boolean;
    open_time: string;
    close_time: string;
  }> = [];

  for (const wd of order) {
    const row = byDay.get(wd);
    if (!row) continue;
    const isOpen = Boolean(row.is_open);
    const key = isOpen ? `${row.open_time}-${row.close_time}` : 'closed';
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.endWd = wd;
    } else {
      groups.push({
        key,
        startWd: wd,
        endWd: wd,
        is_open: isOpen,
        open_time: row.open_time,
        close_time: row.close_time,
      });
    }
  }

  return groups.map((g) => ({
    label:
      g.startWd === g.endWd
        ? (WEEKDAY_NAMES_SHORT[g.startWd] ?? '')
        : `${WEEKDAY_NAMES_SHORT[g.startWd] ?? ''} – ${WEEKDAY_NAMES_SHORT[g.endWd] ?? ''}`,
    value: g.is_open ? `${g.open_time} – ${g.close_time}` : 'Fechado',
  }));
}

interface ShopStatusInfo {
  state: 'open' | 'closed' | 'soon';
  pillLabel: string;
  hoursLabel: string;
}

function computeShopStatus(hours: BusinessHours[] = [], closures: Closure[] = []): ShopStatusInfo {
  const today = todayISO();
  const todayClosure = Array.isArray(closures) ? closures.find((c) => c.date === today) : undefined;
  const openDays = Array.isArray(hours) ? hours.filter((h) => Boolean(h.is_open)) : [];
  const openSummary = groupBusinessHours(openDays)
    .map((g) => `${g.label} ${g.value}`)
    .join(' · ');

  if (todayClosure) {
    const reason = todayClosure.reason || 'Folga';
    return {
      state: 'closed',
      pillLabel: `Fechado hoje · ${reason}`,
      hoursLabel: openSummary ? `Hoje fechado (${reason}) · ${openSummary}` : `Hoje fechado (${reason})`,
    };
  }

  if (!Array.isArray(hours) || !hours.length) {
    return {
      state: 'open',
      pillLabel: 'Agendamento Online',
      hoursLabel: 'Consulte horários disponíveis',
    };
  }

  const todayWd = weekdayOfISO(today);
  const todayRow = hours.find((h) => Number(h.weekday) === todayWd);

  if (!todayRow || !todayRow.is_open) {
    return {
      state: 'closed',
      pillLabel: 'Fechado hoje',
      hoursLabel: openSummary ? `Hoje fechado · ${openSummary}` : 'Fechado hoje',
    };
  }

  const nowMin = nowMinutesAppTz();
  const openMin = hhmmToMinutes(todayRow.open_time || '09:00');
  const closeMin = hhmmToMinutes(todayRow.close_time || '19:00');
  const breakStartMin = todayRow.break_start ? hhmmToMinutes(todayRow.break_start) : null;
  const breakEndMin = todayRow.break_end ? hhmmToMinutes(todayRow.break_end) : null;

  if (nowMin < openMin) {
    return {
      state: 'soon',
      pillLabel: `Abre hoje às ${todayRow.open_time}`,
      hoursLabel: `Atendimento hoje · ${todayRow.open_time} às ${todayRow.close_time}`,
    };
  }

  if (nowMin >= closeMin) {
    return {
      state: 'closed',
      pillLabel: 'Fechado agora',
      hoursLabel: openSummary
        ? `Encerrado hoje (${todayRow.open_time}–${todayRow.close_time}) · ${openSummary}`
        : `Encerrado hoje · ${todayRow.open_time} às ${todayRow.close_time}`,
    };
  }

  if (breakStartMin !== null && breakEndMin !== null && nowMin >= breakStartMin && nowMin < breakEndMin) {
    return {
      state: 'soon',
      pillLabel: `Em intervalo · Volta às ${todayRow.break_end}`,
      hoursLabel: `Aberto hoje · ${todayRow.open_time} às ${todayRow.close_time}`,
    };
  }

  return {
    state: 'open',
    pillLabel: `Aberto agora · até ${todayRow.close_time}`,
    hoursLabel: `Aberto hoje · ${todayRow.open_time} às ${todayRow.close_time}`,
  };
}

function serviceCategoryOf(service: Partial<Service> = {}): Exclude<ServiceCategory, 'all'> {
  const n = `${service.name ?? ''} ${service.description ?? ''}`.toLowerCase();
  if (n.includes('combo') || n.includes('+') || (n.includes('corte') && n.includes('barba'))) return 'combos';
  if (n.includes('barba') || n.includes('barboterapia') || n.includes('bigode')) return 'barba';
  return 'cortes';
}

function renderCategoryPills(): string {
  const counts: Record<ServiceCategory, number> = {
    all: state.services.length,
    cortes: 0,
    barba: 0,
    combos: 0,
  };
  for (const s of state.services) {
    const cat = serviceCategoryOf(s);
    counts[cat] += 1;
  }
  const defs: Array<{ id: ServiceCategory; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'cortes', label: 'Cortes' },
    { id: 'barba', label: 'Barba' },
    { id: 'combos', label: 'Combos' },
  ];
  return defs
    .filter((d) => d.id === 'all' || counts[d.id] >= 2)
    .map(
      (d) =>
        `<button type="button" class="booksy-cat-pill${state.serviceCategory === d.id ? ' active' : ''}" data-cat="${esc(d.id)}">${esc(d.label)}</button>`
    )
    .join('');
}

function bookingLayoutHtml(): string {
  const shopName = state.shop?.name || 'Barbearia';
  const shopAddr = state.shop?.address || 'Atendimento com hora marcada';
  const groupedHours = groupBusinessHours(state.shop?.business_hours);
  const hoursHtml = groupedHours.length
    ? groupedHours
        .map((g) => `<div class="booksy-hours-row"><span>${esc(g.label)}</span><span>${esc(g.value)}</span></div>`)
        .join('')
    : '<div class="booksy-hours-row"><span>Horários</span><span>Consulte a agenda</span></div>';

  return `
  <div class="booksy-layout-grid">
    <div class="booksy-main-col">
      <div class="cuts-showcase-strip" aria-label="Demonstração real de serviços">
        <div class="cuts-showcase-head">
          <span class="cuts-showcase-label">Catálogo de Cortes &amp; Barba</span>
          <button type="button" class="cuts-showcase-link" data-open-tab="cuts">Ver todos &rarr;</button>
        </div>
        <div class="figma-lookbook-grid">
          <button type="button" class="figma-lookbook-card" data-demo-keyword="degrad">
            <img class="figma-lookbook-img" src="/img/cuts/cut-degrade.webp?v=20261123a" srcset="/img/cuts/cut-degrade-480w.webp 480w, /img/cuts/cut-degrade-960w.webp 960w" sizes="(max-width: 600px) 50vw, 240px" alt="Degradê Navalhado" loading="lazy" decoding="async" />
            <span class="figma-lookbook-tag">Mais pedido</span>
            <div class="figma-lookbook-caption">
              <strong>Degradê Navalhado</strong>
              <span>Acabamento na lâmina</span>
            </div>
          </button>
          <button type="button" class="figma-lookbook-card" data-demo-keyword="barba">
            <img class="figma-lookbook-img" src="/img/cuts/cut-barboterapia.webp?v=20261123a" srcset="/img/cuts/cut-barboterapia-480w.webp 480w, /img/cuts/cut-barboterapia-960w.webp 960w" sizes="(max-width: 600px) 50vw, 240px" alt="Barboterapia Tradicional" loading="lazy" decoding="async" />
            <span class="figma-lookbook-tag">Barba</span>
            <div class="figma-lookbook-caption">
              <strong>Barboterapia</strong>
              <span>Toalha quente &amp; navalha</span>
            </div>
          </button>
          <button type="button" class="figma-lookbook-card" data-demo-keyword="social">
            <img class="figma-lookbook-img" src="/img/cuts/cut-social.webp?v=20261123a" srcset="/img/cuts/cut-social-480w.webp 480w, /img/cuts/cut-social-960w.webp 960w" sizes="(max-width: 600px) 50vw, 240px" alt="Corte Clássico na Tesoura" loading="lazy" decoding="async" />
            <span class="figma-lookbook-tag">Clássico</span>
            <div class="figma-lookbook-caption">
              <strong>Corte Clássico</strong>
              <span>Tesoura &amp; pente tradicional</span>
            </div>
          </button>
          <button type="button" class="figma-lookbook-card" data-demo-keyword="combo">
            <img class="figma-lookbook-img" src="/img/cuts/cut-platinado.webp?v=20261123a" srcset="/img/cuts/cut-platinado-480w.webp 480w, /img/cuts/cut-platinado-960w.webp 960w" sizes="(max-width: 600px) 50vw, 240px" alt="Acabamento e Barba" loading="lazy" decoding="async" />
            <span class="figma-lookbook-tag">Completo</span>
            <div class="figma-lookbook-caption">
              <strong>Acabamento &amp; Barba</strong>
              <span>Topete, fade &amp; alinhamento</span>
            </div>
          </button>
        </div>
      </div>

      <div class="card booking-card booksy-services-card" id="sec-service">
        <div class="booksy-toolbar">
          <div class="booksy-search-wrap">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" id="service-search" class="booksy-search-input" placeholder="Buscar serviço..." value="${esc(state.serviceSearch)}" aria-label="Buscar serviço" />
          </div>
          <div class="booksy-cat-pills" role="tablist" aria-label="Categorias de serviços">
            ${renderCategoryPills()}
          </div>
        </div>

        <div class="card-section-head" style="margin-bottom:8px">
          <div>
            <h3>1. Serviços</h3>
          </div>
        </div>
        <div class="choice-list booksy-services-list" id="service-grid"></div>
      </div>

      <div class="card booking-card hidden" id="sec-barber">
        <div class="card-section-head">
          <div>
            <h3>2. Profissional</h3>
            <p class="section-sub">Com qual barbeiro você deseja agendar?</p>
          </div>
        </div>
        <div class="choice-list" id="barber-grid"></div>
      </div>

      <div class="card booking-card hidden" id="sec-date">
        <div class="card-section-head">
          <div>
            <h3>3. Data &amp; 4. Horário</h3>
            <p class="section-sub">Selecione o dia na faixa abaixo e escolha um horário disponível em tempo real</p>
          </div>
        </div>
        <div class="day-strip" id="day-strip"></div>
        <div id="slot-area" style="margin-top:20px"></div>
      </div>

      <div class="card booking-card hidden" id="sec-form">
        <div class="card-section-head">
          <div>
            <h3>5. Seus dados</h3>
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
          Reserva pontual e segura. Sem cobrança antecipada.
        </p>
      </div>
    </div>

    <aside class="booksy-aside-col">
      <div class="booksy-aside-card">
        <div class="booksy-aside-section" id="booksy-aside-summary">
          <span class="booksy-aside-kicker">Sua reserva</span>
          <ol class="booksy-steps-guide">
            <li>1. Escolha o serviço</li>
            <li>2. Escolha o profissional</li>
            <li>3. Escolha a data</li>
            <li>4. Escolha o horário</li>
            <li>5. Seus dados</li>
            <li>6. Confirmação</li>
          </ol>
        </div>
        <div class="booksy-aside-divider"></div>
        <div class="booksy-aside-section">
          <span class="booksy-aside-kicker">Sobre · ${esc(shopName)}</span>
          <p class="booksy-aside-addr">${esc(shopAddr)}</p>
          <div class="booksy-hours-list">
            ${hoursHtml}
          </div>
        </div>
      </div>
    </aside>
  </div>`;
}

/* ------------------------------ Disponibilidade --------------------------- */

async function loadDays(): Promise<void> {
  const from = todayISO();
  const to = addDays(from, daysLimit());
  if (state.isAnyBarber && state.barbers.length) {
    const allDays = await Promise.all(
      state.barbers.map((b) =>
        api.get<PublicCalendarDay[]>(
          `/api/public/calendar${query({ barber_id: b.id, service_id: state.serviceId, from, to })}`
        )
      )
    );
    const openMap = new Map<string, PublicCalendarDay>();
    for (const days of allDays) {
      for (const day of days) {
        if (day.open && !openMap.has(day.date)) openMap.set(day.date, day);
      }
    }
    state.days = Array.from(openMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  } else if (state.barberId) {
    const days = await api.get<PublicCalendarDay[]>(
      `/api/public/calendar${query({ barber_id: state.barberId, service_id: state.serviceId, from, to })}`
    );
    state.days = days.filter((day) => day.open);
  } else {
    state.days = [];
  }

  if (!state.days.some((day) => day.date === state.date)) {
    const firstDay = state.days[0];
    state.date = firstDay ? firstDay.date : null;
  }
}

async function loadSlots(): Promise<void> {
  if (!state.date) {
    state.slots = [];
    state.slotsReason = 'Nenhum dia disponível no momento.';
    return;
  }

  if (state.isAnyBarber && state.barbers.length) {
    const results = await Promise.all(
      state.barbers.map(async (b) => ({
        barber: b,
        res: await api.get<AvailabilityResponse>(
          `/api/public/availability${query({
            barber_id: b.id,
            service_id: state.serviceId,
            date: state.date,
          })}`
        ),
      }))
    );
    const slotBarberMap: Record<string, number> = {};
    for (const { barber, res } of results) {
      for (const slot of res.slots ?? []) {
        if (slotBarberMap[slot] === undefined) slotBarberMap[slot] = barber.id;
      }
    }
    state.slotBarberMap = slotBarberMap;
    state.slots = Object.keys(slotBarberMap).sort();
    const anyOpen = results.some(({ res }) => res.open);
    state.slotsReason = anyOpen
      ? 'Todos os horários deste dia já foram preenchidos.'
      : (results[0]?.res?.reason || 'Barbearia fechada neste dia.');
    if (!state.time || !state.slots.includes(state.time)) {
      state.time = null;
    } else {
      const assignedBarber = slotBarberMap[state.time];
      if (assignedBarber !== undefined) state.barberId = assignedBarber;
    }
    return;
  }

  const result = await api.get<AvailabilityResponse>(
    `/api/public/availability${query({
      barber_id: state.barberId,
      service_id: state.serviceId,
      date: state.date,
    })}`
  );
  state.slots = result.slots ?? [];
  state.slotsReason = result.open ? 'Todos os horários deste dia já foram preenchidos.' : result.reason || '';
  if (!state.time || !state.slots.includes(state.time)) state.time = null;
}

/* --------------------------------- Render --------------------------------- */

function servicePhoto(name = ''): string {
  const n = String(name).toLowerCase();
  if (n.includes('barba') || n.includes('barboterapia')) return '/img/cuts/cut-barboterapia.webp?v=20261123a';
  if (n.includes('social') || n.includes('clássico') || n.includes('classico') || n.includes('tesoura')) {
    return '/img/cuts/cut-social.webp?v=20261123a';
  }
  if (n.includes('platinado') || n.includes('textur') || n.includes('combo') || n.includes('+') || n.includes('visagismo')) {
    return '/img/cuts/cut-platinado.webp?v=20261123a';
  }
  return '/img/cuts/cut-degrade.webp?v=20261123a';
}

function barberPhoto(barber: Partial<Barber> = {}, index = 0): string {
  const photos: readonly string[] = [
    '/img/barber-1.webp?v=20261123a',
    '/img/barber-2.webp?v=20261123a',
    '/img/barber-3.webp?v=20261123a',
  ];
  const idx = Math.abs(Number(barber.id || index + 1) - 1) % photos.length;
  return photos[idx] ?? '/img/barber-1.webp?v=20261123a';
}

function updateBooksyChrome(): void {
  const selectedService = state.services.find((s) => String(s.id) === String(state.serviceId));
  const selectedBarber = state.barbers.find((b) => String(b.id) === String(state.barberId));

  // Barra sticky mobile
  const stickyBar = document.getElementById('booksy-sticky-bar');
  const stickyPrice = document.getElementById('booksy-sticky-price');
  const stickyMeta = document.getElementById('booksy-sticky-meta');
  const stickyCta = document.getElementById('booksy-sticky-cta');
  if (stickyBar && stickyPrice && stickyMeta && stickyCta) {
    if (!selectedService || state.currentTab !== 'booking' || state.confirmed) {
      stickyBar.classList.add('hidden');
      delete stickyBar.dataset.gsapShown;
    } else {
      stickyBar.classList.remove('hidden');
      stickyPrice.textContent = money(selectedService.price);
      animateStickyBarPrice(Number(selectedService.price), stickyBar, stickyPrice);
      const parts = [selectedService.name, `${Number(selectedService.duration_min)} min`];
      if (state.date && state.time) parts.push(`${formatDateBR(state.date)} · ${state.time}`);
      stickyMeta.textContent = parts.join(' · ');
      stickyCta.textContent = state.time ? 'Finalizar reserva' : 'Escolher horário';
    }
  }

  // Card lateral desktop
  const asideSummary = document.getElementById('booksy-aside-summary');
  if (asideSummary) {
    if (!selectedService) {
      asideSummary.innerHTML = `
        <span class="booksy-aside-kicker">Sua reserva</span>
        <ol class="booksy-steps-guide">
          <li>1. Escolha o serviço</li>
          <li>2. Escolha o profissional</li>
          <li>3. Escolha a data</li>
          <li>4. Escolha o horário</li>
          <li>5. Seus dados</li>
          <li>6. Confirmação</li>
        </ol>`;
    } else {
      const barberLabel = state.isAnyBarber
        ? 'Qualquer profissional'
        : selectedBarber?.name || 'A escolher';
      const dateLabel = state.date ? formatDateBR(state.date) : 'A escolher';
      const timeLabel = state.time || 'A escolher';
      asideSummary.innerHTML = `
        <span class="booksy-aside-kicker">Sua reserva</span>
        <div class="booksy-aside-item">
          <strong>${esc(selectedService.name)}</strong>
          <span>${esc(money(selectedService.price))}</span>
        </div>
        <div class="booksy-aside-meta">
          <div><span>Duração</span><strong>${Number(selectedService.duration_min)} min</strong></div>
          <div><span>Profissional</span><strong>${esc(barberLabel)}</strong></div>
          <div><span>Data</span><strong>${esc(dateLabel)}</strong></div>
          <div><span>Horário</span><strong>${esc(timeLabel)}</strong></div>
        </div>`;
    }
  }
}

function wireBooksyToolbar(): void {
  const searchInput = document.getElementById('service-search') as HTMLInputElement | null;
  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = '1';
    searchInput.addEventListener('input', () => {
      state.serviceSearch = searchInput.value || '';
      renderServices();
    });
  }

  document.querySelectorAll<HTMLElement>('.booksy-cat-pill').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      state.serviceCategory = (btn.dataset.cat as ServiceCategory | undefined) || 'all';
      document.querySelectorAll<HTMLElement>('.booksy-cat-pill').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      renderServices();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-demo-keyword]').forEach((card) => {
    if (card.dataset.wired) return;
    card.dataset.wired = '1';
    card.addEventListener('click', () => {
      const kw = String(card.dataset.demoKeyword || '').toLowerCase();
      const match =
        state.services.find((s) => String(s.name || '').toLowerCase().includes(kw)) ||
        (kw === 'social' ? state.services.find((s) => /corte|tesoura|social|cl[aá]ssico/i.test(s.name || '')) : undefined) ||
        (kw === 'combo' ? state.services.find((s) => /combo|\+|barba/i.test(s.name || '')) : undefined) ||
        state.services[0];
      if (match) {
        const btn = document.querySelector<HTMLElement>(`[data-service="${match.id}"]`);
        if (btn) {
          btn.click();
          window.setTimeout(() => {
            document.getElementById('sec-barber')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 90);
          return;
        }
      }
      document.getElementById('sec-service')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderServices(): void {
  wireBooksyToolbar();
  const grid = document.getElementById('service-grid');
  if (!grid) return;

  const term = state.serviceSearch.trim().toLowerCase();
  const filtered = state.services.filter((service) => {
    const matchesCat = state.serviceCategory === 'all' || serviceCategoryOf(service) === state.serviceCategory;
    const matchesTerm =
      !term ||
      String(service.name || '').toLowerCase().includes(term) ||
      String(service.description || '').toLowerCase().includes(term);
    return matchesCat && matchesTerm;
  });

  if (!filtered.length) {
    grid.innerHTML = `<p class="muted" style="padding:18px 0;font-size:13px">Nenhum serviço encontrado para "${esc(state.serviceSearch)}".</p>`;
    updateBooksyChrome();
    return;
  }

  const catLabels: Record<Exclude<ServiceCategory, 'all'>, string> = {
    cortes: 'Corte',
    barba: 'Barba',
    combos: 'Combo',
  };

  grid.innerHTML = filtered
    .map((service, idx) => {
      const isSelected = String(state.serviceId) === String(service.id);
      const cat = serviceCategoryOf(service);
      const isPopular = idx === 0 || /degrad/i.test(service.name || '');
      const badgeHtml = isPopular
        ? '<span class="service-popular-badge">Popular</span>'
        : `<span class="service-cat-badge">${esc(catLabels[cat] || 'Serviço')}</span>`;
      const descText =
        service.description ||
        (cat === 'barba'
          ? 'Alinhamento preciso na navalha e hidratação com toalha quente.'
          : cat === 'combos'
            ? 'Corte completo, acabamento na lâmina e alinhamento de barba.'
            : 'Acabamento técnico na tesoura ou máquina com finalização profissional.');
      return `
      <button type="button" class="choice service-choice booksy-service-row${isSelected ? ' selected' : ''}" data-service="${service.id}">
        <div class="service-left">
          <div class="service-title-row">
            <strong class="service-name">${esc(service.name)}</strong>
            ${badgeHtml}
          </div>
          <p class="service-desc">${esc(descText)}</p>
        </div>
        <div class="service-right">
          <div class="service-price-col">
            <span class="service-price">${esc(money(service.price))}</span>
            <span class="service-duration-mono">${Number(service.duration_min)} min</span>
          </div>
          <span class="booksy-reserve-btn">${isSelected ? '✓ Selecionado' : 'Reservar'}</span>
        </div>
      </button>`;
    })
    .join('');

  grid.querySelectorAll<HTMLElement>('[data-service]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        haptic();
        state.serviceId = Number(element.dataset.service);
        state.time = null;
        renderServices();
        revealSection('sec-barber');
        renderBarbers();
        if (state.barberId || state.isAnyBarber) {
          await bootstrapDateSection();
        }
        setStep(currentStep());
      })();
    })
  );

  updateBooksyChrome();
  animateServicesList(grid);
}

function renderBarbers(): void {
  const grid = document.getElementById('barber-grid');
  if (!grid) return;
  const isAnySelected = state.isAnyBarber;

  const anyCard = `
    <button type="button" class="choice barber-choice${isAnySelected ? ' selected' : ''}" data-barber="any">
      <div class="barber-avatar-box barber-avatar-any">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>
      </div>
      <div class="barber-meta">
        <strong class="barber-name">Primeiro profissional disponível</strong>
        <span class="barber-spec">Menor tempo de espera • Horário mais próximo na agenda</span>
      </div>
      <div class="selection-pill" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>
      </div>
    </button>
  `;

  const barbersList = state.barbers
    .map(
      (barber, idx) => `
      <button type="button" class="choice barber-choice${!isAnySelected && String(state.barberId) === String(barber.id) ? ' selected' : ''}" data-barber="${barber.id}">
        <div class="barber-avatar-box">
          <img class="barber-avatar-img" src="${esc(barberPhoto(barber, idx))}" alt="${esc(barber.name)}" loading="lazy" />
        </div>
        <div class="barber-meta">
          <div class="barber-name-row">
            <strong class="barber-name">${esc(barber.name)}</strong>
            <span class="barber-rating-badge">★ ${Number(barber.rating || 4.9).toFixed(1)}</span>
          </div>
          <span class="barber-spec">${esc(barber.specialties || 'Mestre Barbeiro · Degradê & Barba')}</span>
        </div>
        <div class="selection-pill" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>
        </div>
      </button>`
    )
    .join('');

  grid.innerHTML = anyCard + barbersList;

  grid.querySelectorAll<HTMLElement>('[data-barber]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        haptic();
        const val = element.dataset.barber;
        if (val === 'any') {
          state.isAnyBarber = true;
          state.barberId = state.barbers[0]?.id ?? null;
        } else {
          state.isAnyBarber = false;
          state.barberId = Number(val);
        }
        state.time = null;
        renderBarbers();
        await bootstrapDateSection();
        setStep(currentStep());
      })();
    })
  );
}

function renderDays(): void {
  const strip = document.getElementById('day-strip');
  if (!strip) return;
  if (!state.days.length) {
    strip.innerHTML = '<span class="muted">Nenhum dia com horário livre nos próximos dias.</span>';
    return;
  }
  strip.innerHTML = state.days
    .map((day) => {
      const date = parseISO(day.date);
      const wd = WEEKDAYS_SHORT[date.getDay()] ?? '';
      return `
        <button type="button" class="day-chip${day.date === state.date ? ' selected' : ''}" data-day="${day.date}">
          <span>${esc(wd)}</span>
          <strong>${String(date.getDate()).padStart(2, '0')}</strong>
        </button>`;
    })
    .join('');

  strip.querySelectorAll<HTMLElement>('[data-day]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        haptic();
        state.date = element.dataset.day ?? null;
        state.datePicked = true;
        state.time = null;
        renderDays();
        await refreshSlots();
        setStep(currentStep());
      })();
    })
  );
  animateDayStrip(strip);
}

function renderSlots(): void {
  const area = document.getElementById('slot-area');
  if (!area) return;
  if (!state.slots.length) {
    area.innerHTML = `<div class="empty">${esc(state.slotsReason || 'Nenhum horário livre neste dia.')}</div>`;
    return;
  }
  area.innerHTML = `
    <p class="section-title">4. Horários livres</p>
    <div class="slot-grid">
      ${state.slots
        .map(
          (slot) =>
            `<button type="button" class="slot${slot === state.time ? ' selected' : ''}" data-slot="${slot}">${esc(slot)}</button>`
        )
        .join('')}
    </div>`;

  area.querySelectorAll<HTMLElement>('[data-slot]').forEach((element) =>
    element.addEventListener('click', () => {
      haptic();
      const pickedSlot = element.dataset.slot ?? null;
      state.time = pickedSlot;
      state.datePicked = true;
      if (state.isAnyBarber && pickedSlot && state.slotBarberMap[pickedSlot] !== undefined) {
        state.barberId = state.slotBarberMap[pickedSlot]!;
      }
      renderSlots();
      revealSection('sec-form');
      renderSummary();
      setStep(5);
    })
  );
  animateSlotsGrid(area);
}

function renderSummary(): void {
  const summaryEl = document.getElementById('summary');
  if (!summaryEl) return;
  const service = state.services.find((item) => Number(item.id) === Number(state.serviceId));
  const barber = state.barbers.find((item) => Number(item.id) === Number(state.barberId));
  const barberLabel = state.isAnyBarber && !state.time ? 'Qualquer disponível' : (barber?.name || '-');
  summaryEl.innerHTML = `
    <div><span>Serviço</span><strong>${esc(service?.name || '-')}</strong></div>
    <div><span>Profissional</span><strong>${esc(barberLabel)}</strong></div>
    <div><span>Data</span><strong>${esc(state.date ? formatDateBR(state.date) : '-')}</strong></div>
    <div><span>Horário</span><strong>${esc(state.time || '-')}</strong></div>
    <div><span>Valor</span><strong>${esc(service ? money(service.price) : '-')}</strong></div>`;
}

async function refreshSlots(): Promise<void> {
  const area = document.getElementById('slot-area');
  if (area) {
    area.innerHTML = spinnerBlock('Buscando horários...');
    hydrateLottieElements(area);
  }
  try {
    await loadSlots();
    renderSlots();
  } catch (error: unknown) {
    state.slots = [];
    state.slotsReason = errorMessage(error);
    renderSlots();
  }
  renderSummary();
}

async function bootstrapDateSection(): Promise<void> {
  revealSection('sec-date');
  const area = document.getElementById('slot-area');
  if (area) {
    area.innerHTML = spinnerBlock('Buscando horários...');
    hydrateLottieElements(area);
  }
  try {
    await loadDays();
    if (state.date) state.datePicked = true;
    renderDays();
    await loadSlots();
    renderSlots();
  } catch (error: unknown) {
    const strip = document.getElementById('day-strip');
    if (strip) strip.innerHTML = '';
    state.slots = [];
    state.slotsReason = errorMessage(error);
    renderSlots();
  }
  renderSummary();
}

/* -------------------------------- Confirmação (Etapa 6) ------------------- */

function successHtml(result: PublicBookingResponse): string {
  const appointment = result.appointment;
  const service = state.services.find((item) => Number(item.id) === Number(state.serviceId));
  const fullManageUrl = result.manage_url ? `${window.location.origin}${result.manage_url}` : '';
  const shopPhone = state.shop?.whatsapp || state.shop?.phone || '';

  return `
    <div class="card success-box">
      <div class="lottie-box lottie-lg" data-lottie="success">
        <div class="success-check">${icon('check')}</div>
      </div>
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
          : shopPhone
            ? `<a class="btn btn-whats btn-block" href="https://wa.me/55${esc(String(shopPhone).replace(/\D/g, ''))}?text=${encodeURIComponent('Olá! Acabei de fazer um agendamento pelo site.')}" target="_blank" rel="noopener">
                 ${icon('whatsapp')} Falar com a barbearia no WhatsApp
               </a>`
            : ''
      }
      <button class="btn btn-ghost btn-block" id="pk-again" type="button">Fazer outro agendamento</button>
    </div>`;
}

function renderManageAppointment(token: string, appt: Appointment): void {
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
        <div id="reschedule-section" style="margin-top:24px;padding-top:16px;border-top:1px solid var(--c-border)">
          <h4 style="font-size:14px">Deseja reagendar para outro dia ou horário?</h4>
          <div class="field" style="margin-top:10px">
            <label for="pk-reschedule-date">Nova data</label>
            <input id="pk-reschedule-date" type="date" value="${esc(appt.date)}" />
          </div>
          <div id="pk-reschedule-slots" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>
          <button class="btn btn-primary btn-block" id="btn-do-reschedule" type="button" style="margin-top:12px" disabled>
            Confirmar novo horário
          </button>
        </div>
        <div id="cancel-section" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--c-border)">
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
    const dateInput = document.getElementById('pk-reschedule-date') as HTMLInputElement | null;
    const slotsWrap = document.getElementById('pk-reschedule-slots');
    const rescheduleBtn = document.getElementById('btn-do-reschedule') as HTMLButtonElement | null;
    let selectedSlot = '';

    const loadRescheduleSlots = async (date: string): Promise<void> => {
      selectedSlot = '';
      if (rescheduleBtn) rescheduleBtn.disabled = true;
      if (!slotsWrap) return;
      slotsWrap.innerHTML = '<span class="muted" style="font-size:12.5px">Buscando horários livres...</span>';
      try {
        const res = await api.get<AvailabilityResponse>(
          `/api/public/availability${query({
            barber_id: appt.barber_id,
            service_id: appt.service_id,
            date,
          })}`
        );
        const slots = Array.isArray(res?.slots) ? res.slots : [];
        if (!res?.open || !slots.length) {
          slotsWrap.innerHTML = `<span class="muted" style="font-size:12.5px">${esc(res?.reason || 'Sem horários livres nesta data.')}</span>`;
          return;
        }
        slotsWrap.innerHTML = slots
          .map(
            (slot) =>
              `<button type="button" class="btn btn-sm btn-ghost pk-slot-btn" data-slot="${esc(slot)}">${esc(slot)}</button>`
          )
          .join('');
      } catch (err: unknown) {
        slotsWrap.innerHTML = `<span class="danger" style="font-size:12.5px">${esc(errorMessage(err))}</span>`;
      }
    };

    if (appt.barber_id && appt.service_id) {
      void loadRescheduleSlots(appt.date);
      dateInput?.addEventListener('change', () => {
        if (dateInput.value) void loadRescheduleSlots(dateInput.value);
      });
      slotsWrap?.addEventListener('click', (event: MouseEvent) => {
        const btn = (event.target as HTMLElement | null)?.closest?.('.pk-slot-btn') as HTMLElement | null;
        if (!btn) return;
        selectedSlot = btn.dataset.slot || '';
        slotsWrap.querySelectorAll<HTMLElement>('.pk-slot-btn').forEach((item) => {
          item.classList.toggle('btn-primary', item === btn);
          item.classList.toggle('btn-ghost', item !== btn);
        });
        if (rescheduleBtn) rescheduleBtn.disabled = !selectedSlot;
      });
      rescheduleBtn?.addEventListener('click', () => {
        void (async () => {
          if (!selectedSlot || !dateInput?.value) return;
          rescheduleBtn.disabled = true;
          rescheduleBtn.textContent = 'Reagendando...';
          try {
            const updated = await api.post<{ appointment: Appointment }>(
              `/api/public/appointments/${encodeURIComponent(token)}/reschedule`,
              {
                date: dateInput.value,
                start_time: selectedSlot,
              }
            );
            toast('Agendamento reagendado com sucesso.', 'success');
            renderManageAppointment(token, updated.appointment);
          } catch (err: unknown) {
            toast(errorMessage(err), 'error');
            rescheduleBtn.disabled = false;
            rescheduleBtn.textContent = 'Confirmar novo horário';
          }
        })();
      });
    }

    const cancelBtn = document.getElementById('btn-do-cancel') as HTMLButtonElement | null;
    cancelBtn?.addEventListener('click', () => {
      void (async () => {
        const reasonInput = document.getElementById('pk-cancel-reason') as HTMLInputElement | null;
        const reason = reasonInput ? reasonInput.value.trim() : '';

        const confirmed = await confirmDialog({
          title: 'Cancelar agendamento',
          message: 'Deseja realmente cancelar este agendamento? O horário ficará livre para outro cliente.',
          confirmLabel: 'Cancelar meu horário',
          danger: true,
        });
        if (!confirmed) return;

        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelando...';

        try {
          const updated = await api.post<{ appointment: Appointment }>(
            `/api/public/appointments/${encodeURIComponent(token)}/cancel`,
            { reason }
          );
          toast('Agendamento cancelado com sucesso.', 'success');
          renderManageAppointment(token, updated.appointment);
        } catch (err: unknown) {
          toast(errorMessage(err), 'error');
          cancelBtn.disabled = false;
          cancelBtn.innerHTML = `${icon('ban')} Cancelar meu agendamento`;
        }
      })();
    });
  }
}

async function bootManage(token: string): Promise<void> {
  document.getElementById('progress-container')?.classList.add('hidden');
  document.getElementById('view-tabs')?.classList.add('hidden');
  content().innerHTML = spinnerBlock('Buscando agendamento...');
  hydrateLottieElements(content());

  try {
    const config = await api.get<PublicConfigResponse>('/api/public/config');
    applyShop(config);

    const appt = await api.get<Appointment>(`/api/public/appointments/${encodeURIComponent(token)}`);
    renderManageAppointment(token, appt);
  } catch (error: unknown) {
    content().innerHTML = `
      <div class="card empty-state" style="margin:0 auto">
        <div class="kpi-icon" style="position:static;margin:0 auto 16px;color:var(--c-danger)">${icon('ban')}</div>
        <h3>Agendamento não encontrado</h3>
        <p class="muted" style="margin-top:8px">${esc(errorMessage(error, 'O link pode ser inválido ou expirado.'))}</p>
        <div class="row-actions" style="justify-content:center;margin-top:20px">
          <a class="btn btn-primary" href="/agendar">${icon('calendar')} Fazer um agendamento</a>
        </div>
      </div>`;
  }
}

async function submit(): Promise<void> {
  const nameEl = document.getElementById('pk-name') as HTMLInputElement | null;
  const phoneEl = document.getElementById('pk-phone') as HTMLInputElement | null;
  const emailEl = document.getElementById('pk-email') as HTMLInputElement | null;
  const notesEl = document.getElementById('pk-notes') as HTMLTextAreaElement | null;

  const name = nameEl?.value.trim() ?? '';
  const phone = phoneEl?.value.trim() ?? '';
  const email = emailEl?.value.trim() ?? '';
  const notes = notesEl?.value.trim() ?? '';

  if (!name) {
    toast('Informe seu nome.', 'error');
    return;
  }
  if (phone.replace(/\D/g, '').length < 10) {
    toast('Informe um WhatsApp com DDD.', 'error');
    return;
  }
  if (!state.serviceId || !state.barberId || !state.date || !state.time) {
    toast('Escolha serviço, profissional, data e horário.', 'error');
    return;
  }

  const submitButton = document.getElementById('pk-confirm') as HTMLButtonElement | null;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Enviando...';
  }

  try {
    const result = await api.post<PublicBookingResponse>('/api/public/appointments', {
      name,
      phone,
      email,
      notes,
      barber_id: state.barberId,
      service_id: state.serviceId,
      date: state.date,
      start_time: state.time,
    });
    state.confirmed = true;
    content().innerHTML = successHtml(result);
    animateBookingSuccess(content());
    setStep(6);

    document.getElementById('pk-copy-manage')?.addEventListener('click', () => {
      void (async () => {
        const input = document.getElementById('pk-manage-link') as HTMLInputElement | null;
        if (input) {
          input.select();
          await navigator.clipboard.writeText(input.value).catch(() => {});
          toast('Link copiado para a área de transferência!', 'success');
        }
      })();
    });

    document.getElementById('pk-again')?.addEventListener('click', () => window.location.reload());
  } catch (error: unknown) {
    toast(errorMessage(error), 'error');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = `${icon('check')} Confirmar agendamento`;
    }
    if (errorStatus(error) === 409) {
      await refreshSlots();
      document.getElementById('sec-form')?.classList.add('hidden');
      setStep(currentStep());
    }
  }
}

/* ---------------------------------- Boot ---------------------------------- */

function unavailableHtml(message: string, extra = ''): string {
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

function whatsappLink(phone: string | null | undefined): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
}

function ensureFooterSignature(): void {
  const footer = document.querySelector<HTMLElement>('.booking-footer');
  if (footer && !footer.querySelector('.nr-signature')) {
    footer.insertAdjacentHTML('beforeend', novaRuntimeSignature());
  }
}

function applyShop(config: PublicConfigResponse): void {
  state.shop = config.shop;
  state.services = config.services;
  state.barbers = config.barbers;
  state.reviews = config.reviews || [];

  document.title = `Agendar horário | ${config.shop.name}`;
  const shopNameEl = document.getElementById('shop-name');
  if (shopNameEl) shopNameEl.textContent = config.shop.name;

  const company =
    config.shop.company && config.shop.company !== 'Nova Runtime'
      ? config.shop.company
      : config.shop.address || 'Agendamento Online';
  const shopCompanyEl = document.getElementById('shop-company');
  if (shopCompanyEl) shopCompanyEl.textContent = company;

  const heroNameEl = document.getElementById('shop-hero-name');
  if (heroNameEl) heroNameEl.textContent = config.shop.name;

  const statusInfo = computeShopStatus(config.shop.business_hours, config.shop.closures);
  const statusPillEl = document.getElementById('shop-open-status-pill');
  const statusTextEl = document.getElementById('shop-open-status-text');
  if (statusPillEl) {
    statusPillEl.classList.remove('is-open', 'is-closed', 'is-soon');
    statusPillEl.classList.add(`is-${statusInfo.state}`);
  }
  if (statusTextEl) {
    statusTextEl.textContent = statusInfo.pillLabel;
  }

  const hoursPillEl = document.getElementById('shop-hours-pill');
  if (hoursPillEl) hoursPillEl.textContent = statusInfo.hoursLabel;

  const bioEl = document.getElementById('shop-bio');
  if (bioEl) {
    bioEl.textContent =
      config.shop.description || 'Ambiente exclusivo, cortes de alta precisão e atendimento personalizado.';
  }

  // Botões de ação rápida no cabeçalho
  const quickActions = document.getElementById('shop-actions');
  if (quickActions) {
    const actionBtns: string[] = [];
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
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          @${esc(handle)}
        </a>`
      );
    }
    if (config.shop.address) {
      actionBtns.push(
        `<a class="shop-action-btn address" href="https://maps.google.com/?q=${encodeURIComponent(config.shop.address)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          Como Chegar
        </a>`
      );
    }
    quickActions.innerHTML = actionBtns.join('');
  }

  const links: string[] = [];
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
  ensureFooterSignature();
}

function renderBookingTab(): void {
  state.confirmed = false;
  content().innerHTML = bookingLayoutHtml();
  renderServices();
  if (state.serviceId) {
    revealSection('sec-barber');
    renderBarbers();
  }
  if (state.barberId || state.isAnyBarber) {
    revealSection('sec-date');
    if (state.days.length) {
      renderDays();
      renderSlots();
    } else if (state.serviceId) {
      void bootstrapDateSection();
    }
  }
  if (state.date && state.time) {
    revealSection('sec-form');
    renderSummary();
  }
  document.getElementById('pk-confirm')?.addEventListener('click', () => void submit());
  const phoneInput = document.getElementById('pk-phone') as HTMLInputElement | null;
  phoneInput?.addEventListener('blur', () => {
    phoneInput.value = formatPhone(phoneInput.value);
  });
  setStep(currentStep());
}

function renderCutsTab(): void {
  const distinctPhotos: readonly string[] = [
    '/img/cuts/cut-degrade.webp?v=20261123a',
    '/img/cuts/cut-barboterapia.webp?v=20261123a',
    '/img/cuts/cut-social.webp?v=20261123a',
    '/img/cuts/cut-platinado.webp?v=20261123a',
  ];
  const defaultCuts: CutGalleryItem[] = [
    { tag: 'Degradê', title: 'Degradê Navalhado (Fade)', desc: 'Disfarce limpo na zero ou navalha com acabamento preciso.', img: distinctPhotos[0] },
    { tag: 'Barba', title: 'Barboterapia Tradicional', desc: 'Toalha quente, espuma hidratante e alinhamento na navalha.', img: distinctPhotos[1] },
    { tag: 'Clássico', title: 'Corte Clássico na Tesoura', desc: 'Corte social tradicional na tesoura e pente com caimento natural.', img: distinctPhotos[2] },
    { tag: 'Completo', title: 'Acabamento, Topete & Barba', desc: 'Finalização estruturada com fade moderno e barba desenhada.', img: distinctPhotos[3] },
  ];
  const rawCuts = state.shop?.cuts_gallery?.length ? state.shop.cuts_gallery : defaultCuts;
  const usedPhotos = new Set<string>();
  const cuts = rawCuts.map((cut, idx) => {
    const candidate = cut.img
      ? `${String(cut.img).split('?')[0]}?v=20261115h`
      : servicePhoto(`${cut.title || ''} ${cut.tag || ''}`);
    const fallbackImg = distinctPhotos[idx % distinctPhotos.length] ?? '/img/cuts/cut-degrade.webp?v=20261123a';
    const finalImg = !usedPhotos.has(candidate) ? candidate : fallbackImg;
    usedPhotos.add(finalImg);
    return {
      ...cut,
      img: finalImg,
    };
  });

  content().innerHTML = `
    <div class="card booking-card">
      <div class="card-section-head">
        <div>
          <h3>Exemplos de Cortes &amp; Trabalhos</h3>
          <p class="section-sub">Fotos reais de estilos executados pela nossa equipe</p>
        </div>
      </div>
      <div class="cuts-grid">
        ${cuts
          .map(
            (cut) => `
          <div class="cut-card">
            <div class="cut-thumb-photo-wrap">
              <img class="cut-thumb-img" src="${esc(cut.img)}" alt="${esc(cut.title)}" loading="lazy" />
              <span class="cut-thumb-tag">${esc(cut.tag || 'Corte')}</span>
            </div>
            <div class="cut-card-body">
              <h4 class="cut-card-title">${esc(cut.title)}</h4>
              <p class="cut-card-desc">${esc(cut.desc)}</p>
              <button type="button" class="btn btn-sm btn-block btn-primary" style="margin-top:10px" data-action="pick-cut">
                Agendar este estilo
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>`;

  content().querySelectorAll<HTMLElement>('[data-action="pick-cut"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector<HTMLElement>('[data-tab="booking"]')?.click();
    });
  });
  animateLookbookCards(content());
}

function renderTeamTab(): void {
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
            (barber, idx) => `
          <div class="barber-rich-card">
            <div class="barber-rich-avatar">
              <img class="barber-avatar-img" src="${esc(barberPhoto(barber, idx))}" alt="${esc(barber.name)}" loading="lazy" />
            </div>
            <div class="barber-rich-info">
              <div class="barber-rich-name-row">
                <strong style="color:var(--text);font-size:15px">${esc(barber.name)}</strong>
                <span class="rating-pill">★ ${Number(barber.rating || 4.9).toFixed(1)}</span>
              </div>
              <span class="barber-rich-spec">${esc(barber.specialties || 'Mestre Barbeiro')}</span>
              <p class="barber-rich-bio">${esc(barber.bio || 'Especialista em visagismo, corte masculino e barba alinhada.')}</p>
              <button type="button" class="btn btn-sm btn-ghost" style="margin-top:8px" data-barber-pick="${barber.id}">
                Agendar com ${esc(barber.name.split(' ')[0] ?? barber.name)} &rarr;
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>`;

  content().querySelectorAll<HTMLElement>('[data-barber-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.barberId = Number(btn.dataset.barberPick);
      state.isAnyBarber = false;
      document.querySelector<HTMLElement>('[data-tab="booking"]')?.click();
    });
  });
  animateLookbookCards(content());
}

function renderReviewsTab(): void {
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
      <form id="review-inline-form" class="card hidden" style="margin-top:16px;padding:18px;border:1px solid var(--border-accent)">
        <h4 style="margin:0 0 12px;font-size:15px">Nova Avaliação</h4>
        <div class="field" style="margin-bottom:12px">
          <label for="rev-name">Seu nome</label>
          <input id="rev-name" placeholder="Ex.: Carlos Eduardo" maxlength="80" required />
        </div>
        <div class="field" style="margin-bottom:12px">
          <label>Sua nota</label>
          <div id="rev-stars" style="display:flex;gap:6px;margin-top:4px">
            ${[1, 2, 3, 4, 5]
              .map(
                (n) =>
                  `<button type="button" class="btn btn-ghost btn-sm rev-star-btn" data-star="${n}" style="padding:6px 10px;font-size:16px;color:#F59E0B" aria-label="${n} estrela${n > 1 ? 's' : ''}">★</button>`
              )
              .join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:14px">
          <label for="rev-comment">Comentário</label>
          <textarea id="rev-comment" rows="3" placeholder="Conte como foi seu atendimento..." maxlength="400" required></textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost btn-sm" id="rev-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary btn-sm" id="rev-submit">Enviar Avaliação</button>
        </div>
      </form>
    </div>`;

  let selectedRating = 5;
  const openBtn = document.getElementById('btn-open-review');
  const form = document.getElementById('review-inline-form') as HTMLFormElement | null;
  const starBtns = form ? Array.from(form.querySelectorAll<HTMLElement>('.rev-star-btn')) : [];
  const paintStars = (val: number): void => {
    starBtns.forEach((b) => {
      const n = Number(b.dataset.star);
      b.style.opacity = n <= val ? '1' : '0.35';
    });
  };
  paintStars(selectedRating);
  starBtns.forEach((btn) =>
    btn.addEventListener('click', () => {
      selectedRating = Number(btn.dataset.star);
      paintStars(selectedRating);
    })
  );
  openBtn?.addEventListener('click', () => {
    openBtn.classList.add('hidden');
    form?.classList.remove('hidden');
    (document.getElementById('rev-name') as HTMLInputElement | null)?.focus();
  });
  document.getElementById('rev-cancel')?.addEventListener('click', () => {
    form?.classList.add('hidden');
    openBtn?.classList.remove('hidden');
  });
  form?.addEventListener('submit', (ev: SubmitEvent) => {
    ev.preventDefault();
    void (async () => {
      const nameInput = document.getElementById('rev-name') as HTMLInputElement | null;
      const commentInput = document.getElementById('rev-comment') as HTMLTextAreaElement | null;
      const clientName = nameInput?.value.trim() ?? '';
      const comment = commentInput?.value.trim() ?? '';
      if (!clientName || !comment) {
        toast('Preencha seu nome e comentário.', 'error');
        return;
      }
      const submitBtn = document.getElementById('rev-submit') as HTMLButtonElement | null;
      if (submitBtn) submitBtn.disabled = true;
      try {
        await api.post('/api/public/reviews', {
          shop_slug: state.shop?.slug || 'nova-barbearia',
          client_name: clientName,
          rating: selectedRating,
          comment,
        });
        toast('Avaliação enviada com sucesso! Obrigado pelo feedback.', 'success');
        state.reviews.unshift({ client_name: clientName, rating: selectedRating, comment });
        renderReviewsTab();
      } catch (err: unknown) {
        toast(errorMessage(err), 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    })();
  });
  animateLookbookCards(content());
}

function setupTabs(): void {
  document.querySelectorAll<HTMLElement>('.shop-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic();
      document.querySelectorAll<HTMLElement>('.shop-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = (btn.dataset.tab as PublicTab | undefined) || 'booking';
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
      updateBooksyChrome();
    });
  });
}

async function boot(): Promise<void> {
  initGsapMotion();
  initPublicSmoothScroll();
  ensureFooterSignature();

  try {
    const params = new URLSearchParams(window.location.search);
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const pathManageToken =
      pathParts[0] === 'agendamento' && pathParts[1] ? pathParts[1] : null;
    const manageToken =
      pathManageToken || params.get('manage') || params.get('cancel') || params.get('token');
    if (manageToken) {
      await bootManage(manageToken);
      return;
    }

    let shopSlug = params.get('shop') || '';
    if (pathParts[0] === 'b' && pathParts[1]) {
      shopSlug = pathParts[1];
    }

    const config = await api.get<PublicConfigResponse>(
      `/api/public/config${query({ shop: shopSlug || 'nova-barbearia' })}`
    );
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

    content().addEventListener('click', (event: MouseEvent) => {
      const openTabBtn = (event.target as HTMLElement | null)?.closest?.('[data-open-tab]') as HTMLElement | null;
      if (!openTabBtn) return;
      const targetTab = openTabBtn.getAttribute('data-open-tab');
      if (targetTab) {
        document.querySelector<HTMLElement>(`[data-tab="${targetTab}"]`)?.click();
      }
    });

    content().innerHTML = bookingLayoutHtml();
    renderServices();
    animateBookingBoot();
    document.getElementById('pk-confirm')?.addEventListener('click', () => void submit());
    document.getElementById('booksy-sticky-cta')?.addEventListener('click', () => {
      const targetId = state.time
        ? 'sec-form'
        : state.barberId || state.isAnyBarber
          ? 'sec-date'
          : 'sec-barber';
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const phoneInput = document.getElementById('pk-phone') as HTMLInputElement | null;
    phoneInput?.addEventListener('blur', () => {
      phoneInput.value = formatPhone(phoneInput.value);
    });
    setStep(1);
  } catch (error: unknown) {
    content().innerHTML = unavailableHtml('Não foi possível carregar a agenda', errorMessage(error));
    document.getElementById('progress-container')?.classList.add('hidden');
    document.getElementById('steps')?.classList.add('hidden');
  }
}

void boot();
