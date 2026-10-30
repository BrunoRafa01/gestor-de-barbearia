// Painel administrativo do Gestor de Barbearia - Nova Runtime.
//
// SPA em JavaScript puro (modulos ES) que consome a API REST do servidor.
// Views: dashboard, agenda (dia/semana), agendamentos, clientes, profissionais,
// servicos e configuracoes (horarios, folgas, WhatsApp e seguranca).

import { api, query } from './api.js';
import {
  addDays,
  button,
  confirmDialog,
  debounce,
  emptyBlock,
  esc,
  formatDateBR,
  formatDateLong,
  formatMonthYear,
  formatPhone,
  hhmmToMinutes,
  icon,
  initials,
  minutesToHHMM,
  money,
  openModal,
  openWhatsapp,
  parseISO,
  readForm,
  setBusy,
  spinnerBlock,
  startOfWeek,
  statusPill,
  STATUS_META,
  toast,
  todayISO,
  toISO,
  WEEKDAYS_SHORT,
} from './ui.js';
import { openAppointmentDetails, openAppointmentForm } from './appointments-ui.js';

/* --------------------------------- Estado -------------------------------- */

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Gestão' },
  { key: 'agenda', label: 'Agenda', icon: 'calendar', group: 'Gestão' },
  { key: 'appointments', label: 'Agendamentos', icon: 'list', group: 'Gestão' },
  { key: 'clients', label: 'Clientes', icon: 'users', group: 'Gestão' },
  { key: 'reports', label: 'Relatórios', icon: 'chart', group: 'Gestão' },
  { key: 'barbers', label: 'Profissionais', icon: 'scissors', group: 'Cadastros' },
  { key: 'services', label: 'Serviços', icon: 'tag', group: 'Cadastros' },
  { key: 'settings', label: 'Configurações', icon: 'settings', group: 'Sistema' },
  { key: 'backup', label: 'Backup', icon: 'database', group: 'Sistema' },
];

const ROW_MINUTES = 30; // altura de cada linha da agenda
const ROW_HEIGHT = 46; // px - igual a --slot-h do CSS

const state = {
  me: null,
  settings: {},
  view: 'dashboard',
  date: todayISO(),
  mode: 'day',
  barberFilter: '',
  catalog: { loaded: false, barbers: [], services: [] },
  appointmentFilters: null,
  reportFilters: null,
};

const content = () => document.getElementById('content');
const refresh = () => navigate(state.view);

/* -------------------------------- Auxiliares ------------------------------ */

function optionsFrom(list, selected, labelFn, valueFn = (item) => item.id) {
  return list
    .map((item) => {
      const value = String(valueFn(item));
      const isSelected = String(selected ?? '') === value ? ' selected' : '';
      return `<option value="${esc(value)}"${isSelected}>${esc(labelFn(item))}</option>`;
    })
    .join('');
}

function statusOptions(selected) {
  return Object.entries(STATUS_META)
    .map(
      ([key, meta]) =>
        `<option value="${key}"${key === selected ? ' selected' : ''}>${esc(meta.label)}</option>`
    )
    .join('');
}

function weekdayOfISO(iso) {
  return parseISO(iso).getDay();
}

function weekDates(iso) {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function kpi({ label, value, foot = '', small = false, iconName = null }) {
  return `
    <div class="kpi">
      ${iconName ? `<div class="kpi-icon">${icon(iconName)}</div>` : ''}
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value${small ? ' small' : ''}">${value}</div>
      ${foot ? `<div class="kpi-foot">${foot}</div>` : ''}
    </div>`;
}

async function loadCatalog(force = false) {
  if (state.catalog.loaded && !force) return;
  const [barbers, services] = await Promise.all([api.get('/api/barbers'), api.get('/api/services')]);
  state.catalog = { loaded: true, barbers, services };
}

function onboardingNotice() {
  const missing = [];
  if (!state.catalog.services.length) missing.push('serviços');
  if (!state.catalog.barbers.length) missing.push('profissionais');
  if (!missing.length) return '';
  return `
    <div class="card" style="border-color:var(--gold-line);background:linear-gradient(150deg, var(--gold-soft), transparent 60%)">
      <div class="card-header">
        <div class="kpi-icon" style="position:static">${icon('sparkles')}</div>
        <div>
          <h3>Comece por aqui</h3>
          <div class="card-sub">O sistema está vazio: nenhum dado de demonstração é exibido como real.</div>
        </div>
      </div>
      <p class="muted">
        Para liberar a agenda falta cadastrar ${esc(missing.join(' e '))}. Depois disso você já pode
        criar agendamentos, ver o faturamento e liberar a página pública de agendamento.
      </p>
      <div class="row-actions" style="margin-top:14px">
        ${!state.catalog.services.length ? button(`${icon('tag')} Cadastrar serviço`, () => { location.hash = '#/services'; }, 'btn') : ''}
        ${!state.catalog.barbers.length ? button(`${icon('scissors')} Cadastrar profissional`, () => { location.hash = '#/barbers'; }, 'btn') : ''}
        ${button(`${icon('settings')} Configurar funcionamento`, () => { location.hash = '#/settings'; }, 'btn btn-ghost')}
      </div>
    </div>`;
}

/** Aviso exibido enquanto a senha inicial do painel nao for trocada. */
function securityNotice() {
  if (!state.me?.password_is_default) return '';
  return `
    <div class="notice">
      <div class="notice-icon">${icon('lock')}</div>
      <div class="grow">
        <strong>Troque a senha do painel</strong>
        <span>O sistema ainda está com a senha inicial. Defina uma senha sua em Configurações > Segurança.</span>
      </div>
      ${button(`${icon('settings')} Trocar agora`, () => { location.hash = '#/settings'; }, 'btn btn-sm')}
    </div>`;
}

/** Aviso exibido quando o painel esta rodando em modo demonstracao. */
function demoNotice() {
  if (!state.me?.demo) return '';
  return `
    <div class="notice notice-demo">
      <div class="notice-icon">${icon('sparkles')}</div>
      <div class="grow">
        <strong>Modo demonstração</strong>
        <span>Todos os dados exibidos são fictícios e servem apenas para apresentar o sistema.</span>
      </div>
    </div>`;
}

/* --------------------------------- Login --------------------------------- */

function renderLogin() {
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="page-centered">
      <form class="auth-card" id="login-form">
        <div class="brand">
          <div class="brand-mark">GB</div>
          <div class="brand-text">
            <strong>Gestor de Barbearia</strong>
            <span>Nova Runtime</span>
          </div>
        </div>
        <h1>Acesso ao painel</h1>
        <p class="auth-sub">Entre com a senha de administrador para gerenciar agenda, clientes e faturamento.</p>
        <div class="field">
          <label for="login-password">Senha do painel</label>
          <input type="password" id="login-password" name="password" autocomplete="current-password" placeholder="Digite sua senha" />
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary btn-block" type="submit">Entrar</button>
        </div>
        <div class="auth-hint">
          Primeiro acesso: a senha inicial vem da variável <b>ADMIN_PASSWORD</b> no arquivo <b>.env</b>
          (padrão <b>admin123</b>). Após entrar, troque a senha em <b>Configurações</b>.
        </div>
      </form>
    </div>`;

  const form = document.getElementById('login-form');
  const passwordInput = document.getElementById('login-password');
  passwordInput.focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    setBusy(submit, true, 'Entrando...');
    try {
      await api.post('/api/auth/login', { password: passwordInput.value });
      await startApp();
    } catch (error) {
      toast(error.message, 'error');
      setBusy(submit, false);
      passwordInput.select();
    }
  });
}

/* --------------------------------- Shell --------------------------------- */

function navItem(item) {
  return `<a class="nav-item" data-view="${item.key}" href="#/${item.key}">${icon(item.icon)}<span>${esc(item.label)}</span></a>`;
}

function shellHtml() {
  const groups = ['Gestão', 'Cadastros', 'Sistema'];
  const navHtml = groups
    .map((group) => {
      const items = NAV.filter((item) => item.group === group);
      if (!items.length) return '';
      return `<div class="nav-label">${esc(group)}</div>${items.map(navItem).join('')}`;
    })
    .join('');

  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">GB</div>
          <div class="brand-text">
            <strong>Gestor de Barbearia</strong>
            <span>Nova Runtime</span>
          </div>
        </div>
        <nav class="nav">${navHtml}</nav>
        <div class="sidebar-footer">
          <a class="nav-item" href="/agendar" target="_blank" rel="noopener">${icon('external')}<span>Página de agendamento</span></a>
          <button class="nav-item" type="button" id="logout">${icon('logout')}<span>Sair do painel</span></button>
          <div class="company">Desenvolvido por Nova Runtime</div>
        </div>
      </aside>
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <div class="main">
        <header class="topbar">
          <button class="sidebar-toggle" id="menu-toggle" type="button" aria-label="Abrir menu">${icon('menu')}</button>
          <div class="topbar-title">
            <h1 id="page-title">Dashboard</h1>
            <p id="page-sub"></p>
          </div>
          <div class="topbar-actions">
            <button class="btn btn-primary" id="quick-new" type="button">${icon('plus')}<span class="hide-mobile">Novo agendamento</span></button>
          </div>
        </header>
        ${securityNotice()}
        ${demoNotice()}
        <main class="content" id="content"></main>
      </div>
    </div>`;
}

function wireShell() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  };

  document.getElementById('menu-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('open');
  });
  backdrop.addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-item[data-view]').forEach((element) => {
    element.addEventListener('click', closeSidebar);
  });

  document.getElementById('quick-new').addEventListener('click', () => {
    openAppointmentForm({ defaults: { date: state.date }, onSaved: refresh });
  });

  document.getElementById('logout').addEventListener('click', async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignora */
    }
    location.hash = '';
    renderLogin();
  });
}

/* ------------------------------- Navegacao -------------------------------- */

const TITLES = {
  dashboard: 'Dashboard',
  agenda: 'Agenda',
  appointments: 'Agendamentos',
  clients: 'Clientes',
  reports: 'Relatórios',
  barbers: 'Profissionais',
  services: 'Serviços',
  settings: 'Configurações',
  backup: 'Backup e dados',
};

function subtitleFor(view) {
  switch (view) {
    case 'dashboard':
      return formatDateLong(state.date);
    case 'agenda':
      return state.mode === 'week'
        ? `Semana de ${formatDateBR(weekDates(state.date)[0])} a ${formatDateBR(weekDates(state.date)[6])}`
        : formatDateLong(state.date);
    case 'appointments':
      return 'Crie, confirme, edite e cancele agendamentos.';
    case 'clients':
      return 'Cadastro e histórico de atendimentos.';
    case 'reports':
      return 'Faturamento, ocupação e desempenho por período.';
    case 'barbers':
      return 'Equipe, comissões e horários de trabalho.';
    case 'services':
      return 'Serviços, duração e preços.';
    case 'settings':
      return 'Funcionamento, folgas, WhatsApp e segurança.';
    case 'backup':
      return 'Exporte, restaure e proteja os dados da barbearia.';
    default:
      return '';
  }
}

async function navigate(view) {
  const meta = NAV.find((item) => item.key === view) || NAV[0];
  state.view = meta.key;

  document.querySelectorAll('.nav-item[data-view]').forEach((element) => {
    element.classList.toggle('active', element.dataset.view === meta.key);
  });
  const title = document.getElementById('page-title');
  const sub = document.getElementById('page-sub');
  if (title) title.textContent = TITLES[meta.key];
  if (sub) sub.textContent = subtitleFor(meta.key);

  content().innerHTML = spinnerBlock();
  try {
    await VIEWS[meta.key]();
  } catch (error) {
    if (error.status === 401) {
      renderLogin();
      return;
    }
    content().innerHTML = emptyBlock('Nao foi possivel carregar esta tela', error.message);
  }
}

/* -------------------------------- Dashboard ------------------------------- */

async function viewDashboard() {
  await loadCatalog();
  const data = await api.get(`/api/dashboard${query({ date: state.date })}`);
  const { today, week, month } = data;
  const rate = today.occupancy.rate;

  const quickActionsBar = `
    <div class="row-actions" style="margin-bottom:16px;gap:10px">
      <button class="btn btn-primary" id="dash-quick-new" type="button">${icon('plus')} Novo Agendamento</button>
      <button class="btn" id="dash-quick-client" type="button">${icon('users')} Novo Cliente</button>
      <button class="btn" id="dash-quick-link" type="button">${icon('copy')} Copiar Link Público</button>
      <button class="btn btn-ghost" id="dash-quick-agenda" type="button">${icon('calendar')} Ver Agenda Completa</button>
    </div>`;

  const dayNav = `
    <div class="toolbar">
      <button class="icon-btn" id="dash-prev" type="button" aria-label="Dia anterior">${icon('left')}</button>
      <button class="btn" id="dash-today" type="button">Hoje</button>
      <button class="icon-btn" id="dash-next" type="button" aria-label="Próximo dia">${icon('right')}</button>
      <input class="control" type="date" id="dash-date" value="${esc(state.date)}" />
      <span class="grow"></span>
      <button class="btn btn-primary" id="dash-new" type="button">${icon('plus')} Novo agendamento</button>
    </div>`;

  const todayTimeline = today.appointments.length
    ? `<div class="timeline">${today.appointments
        .map(
          (item) => `
          <div class="timeline-item" data-appt="${item.id}" style="cursor:pointer">
            <div class="timeline-time">${esc(item.start_time)}</div>
            <div class="timeline-main">
              <strong>${esc(item.client_name)}</strong>
              <span>${esc(item.service_name || 'Serviço')} - ${esc(item.barber_name)} - ${esc(money(item.price))}</span>
            </div>
            ${statusPill(item.status)}
          </div>`
        )
        .join('')}</div>`
    : emptyBlock('Nenhum agendamento neste dia', 'Clique em "Novo agendamento" para começar.');

  const upcomingList = data.upcoming.length
    ? `<div>${data.upcoming
        .map(
          (item) => `
          <div class="list-row" data-appt="${item.id}" style="cursor:pointer">
            <div class="avatar">${esc(initials(item.client_name))}</div>
            <div class="grow">
              <strong>${esc(item.client_name)}</strong>
              <span>${esc(formatDateBR(item.date))} às ${esc(item.start_time)} - ${esc(item.barber_name)}</span>
            </div>
            ${statusPill(item.status)}
          </div>`
        )
        .join('')}</div>`
    : emptyBlock('Sem agendamentos futuros');

  const rankTable = (rows, emptyLabel) => {
    if (!rows.length) return `<div class="empty">${esc(emptyLabel)}</div>`;
    const maxVal = Math.max(...rows.map((r) => r.total || 1), 1);
    return `<div class="bars" style="padding:10px 0">${rows
      .map((row) => {
        const pct = Math.round((row.total / maxVal) * 100);
        return `
        <div class="bar-row">
          <span class="bar-label" title="${esc(row.name)}">${esc(row.name)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
          <span class="bar-value mono"><strong>${row.total}</strong> <small class="faint">(${esc(money(row.revenue))})</small></span>
        </div>`;
      })
      .join('')}</div>`;
  };

  const notice = onboardingNotice();

  const occupancyPct = rate === null ? 0 : Math.max(0, Math.min(100, Number(rate)));
  const realizedPct = today.revenue_expected
    ? Math.min(100, Math.round((today.revenue_realized / today.revenue_expected) * 100))
    : 0;

  const heroBlock = `
    <section class="hero">
      <div class="hero-main">
        <span class="hero-eyebrow">${esc(formatDateLong(state.date))}</span>
        <h2 class="hero-title">${today.total} agendamento(s) neste dia</h2>
        <div class="hero-meta">
          <span class="pill pill-pending">${today.pending} aguardando</span>
          <span class="pill pill-confirmed">${today.confirmed} confirmados</span>
          <span class="pill pill-completed">${today.completed} concluídos</span>
        </div>
      </div>
      <div class="hero-gauge">
        <span class="hero-gauge-label">Ocupação do dia</span>
        <strong>${rate === null ? '--' : `${rate}%`}</strong>
        <div class="progress"><span style="width:${occupancyPct}%"></span></div>
        <span class="hero-gauge-foot">${today.occupancy.barbers} profissional(is) ativo(s)</span>
      </div>
      <div class="hero-gauge">
        <span class="hero-gauge-label">Receita realizada</span>
        <strong>${esc(money(today.revenue_realized))}</strong>
        <div class="progress"><span style="width:${realizedPct}%"></span></div>
        <span class="hero-gauge-foot">${realizedPct}% do previsto (${esc(money(today.revenue_expected))})</span>
      </div>
    </section>`;

  content().innerHTML = `
    ${notice}
    ${quickActionsBar}
    ${heroBlock}

    <div class="grid grid-kpi" style="margin-top:16px">
      ${kpi({ label: 'Agendamentos do dia', value: today.total, iconName: 'calendar', foot: `${today.pending} aguardando - ${today.confirmed} confirmados` })}
      ${kpi({ label: 'Receita prevista', value: esc(money(today.revenue_expected)), small: true, iconName: 'wallet', foot: 'Agendamentos ativos de hoje' })}
      ${kpi({ label: 'Receita realizada', value: esc(money(today.revenue_realized)), small: true, iconName: 'chart', foot: `${today.completed} concluído(s)` })}
      ${kpi({ label: 'Faltas e cancelamentos', value: today.cancelled + today.no_show, iconName: 'ban', foot: `${today.cancelled} cancelado(s) - ${today.no_show} falta(s)` })}
    </div>

    <div class="grid grid-kpi" style="margin-top:16px">
      ${kpi({ label: 'Esta semana', value: week.total, foot: `Previsto: ${esc(money(week.revenue_expected))}` })}
      ${kpi({ label: 'Este mês', value: month.total, foot: `Previsto: ${esc(money(month.revenue_expected))}` })}
      ${kpi({ label: 'Ticket médio (mês)', value: esc(money(month.average_ticket)), small: true, foot: `${month.completed} atendimentos concluídos` })}
      ${kpi({ label: 'Novos clientes (mês)', value: month.new_clients })}
    </div>

    ${dayNav}

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header">
          <h2>Agenda do dia</h2>
          <span class="spacer"></span>
          <button class="btn btn-sm" id="dash-open-agenda" type="button">Abrir agenda</button>
        </div>
        ${todayTimeline}
      </div>
      <div class="card">
        <div class="card-header"><h2>Próximos agendamentos</h2></div>
        ${upcomingList}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header">
          <h2>Serviços mais procurados</h2>
          <span class="spacer"></span>
          <span class="card-sub">${esc(formatMonthYear(state.date))}</span>
        </div>
        ${rankTable(data.top_services, 'Nenhum atendimento no mês.')}
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Desempenho por profissional</h2>
          <span class="spacer"></span>
          <span class="card-sub">${esc(formatMonthYear(state.date))}</span>
        </div>
        ${rankTable(data.top_barbers, 'Nenhum atendimento no mês.')}
      </div>
    </div>`;

  const gotoDay = (iso) => {
    state.date = iso;
    refresh();
  };
  document.getElementById('dash-prev').addEventListener('click', () => gotoDay(addDays(state.date, -1)));
  document.getElementById('dash-next').addEventListener('click', () => gotoDay(addDays(state.date, 1)));
  document.getElementById('dash-today').addEventListener('click', () => gotoDay(todayISO()));
  document.getElementById('dash-date').addEventListener('change', (event) => {
    if (event.target.value) gotoDay(event.target.value);
  });
  document.getElementById('dash-open-agenda').addEventListener('click', () => {
    location.hash = '#/agenda';
  });
  document.getElementById('dash-new').addEventListener('click', () => {
    openAppointmentForm({ defaults: { date: state.date }, onSaved: refresh });
  });

  const quickNew = document.getElementById('dash-quick-new');
  if (quickNew) {
    quickNew.addEventListener('click', () => {
      openAppointmentForm({ defaults: { date: state.date }, onSaved: refresh });
    });
  }

  const quickClient = document.getElementById('dash-quick-client');
  if (quickClient) {
    quickClient.addEventListener('click', () => {
      openClientForm(null);
    });
  }

  const quickLink = document.getElementById('dash-quick-link');
  if (quickLink) {
    quickLink.addEventListener('click', () => {
      const publicUrl = `${location.origin}/agendar`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(publicUrl).then(() => {
          toast('Link de agendamento copiado para a área de transferência!', 'ok');
        }).catch(() => {
          window.open('/agendar', '_blank');
        });
      } else {
        window.open('/agendar', '_blank');
      }
    });
  }

  const quickAgenda = document.getElementById('dash-quick-agenda');
  if (quickAgenda) {
    quickAgenda.addEventListener('click', () => {
      location.hash = '#/agenda';
    });
  }

  content()
    .querySelectorAll('[data-appt]')
    .forEach((element) =>
      element.addEventListener('click', async () => {
        try {
          const appointment = await api.get(`/api/appointments/${element.dataset.appt}`);
          openAppointmentDetails(appointment, { onChanged: refresh });
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
}

/* --------------------------------- Agenda -------------------------------- */

function computeRange(barbers, weekdays) {
  let start = 24 * 60;
  let end = 0;
  for (const barber of barbers) {
    for (const day of barber.hours || []) {
      if (!Number(day.is_working) || !weekdays.includes(Number(day.weekday))) continue;
      start = Math.min(start, hhmmToMinutes(day.start_time));
      end = Math.max(end, hhmmToMinutes(day.end_time));
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    start = 8 * 60;
    end = 20 * 60;
  }
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

function layoutLanes(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds = [];
  const placed = sorted.map((item) => {
    let lane = laneEnds.findIndex((value) => value <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    return { ...item, lane };
  });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

function blockHtml(item, rangeStart, laneCount, compact) {
  const offset = ((item.startMin - rangeStart) / ROW_MINUTES) * ROW_HEIGHT;
  const height = ((item.endMin - item.startMin) / ROW_MINUTES) * ROW_HEIGHT;
  const widthPct = 100 / laneCount;
  const leftPct = item.lane * widthPct;
  const title = compact
    ? `${item.start_time} ${item.client_name}`
    : `${item.client_name}`;
  const sub = compact
    ? `${item.barber_name}`
    : `${item.start_time}-${item.end_time} — ${item.service_name || 'Serviço'}`;
  return `
    <div class="appt-block status-${esc(item.status)}${compact ? ' compact' : ''}" data-appt="${item.id}"
         style="top:${offset + 2}px;height:${Math.max(22, height - 4)}px;left:calc(${leftPct}% + 3px);width:calc(${widthPct}% - 6px);right:auto">
      <strong>${esc(title)}</strong>
      <span>${esc(sub)}</span>
    </div>`;
}

async function viewAgenda() {
  await loadCatalog();

  const toolbar = `
    <div class="toolbar">
      <div class="segmented" id="mode-switch">
        <button type="button" data-mode="day" class="${state.mode === 'day' ? 'active' : ''}">Dia</button>
        <button type="button" data-mode="week" class="${state.mode === 'week' ? 'active' : ''}">Semana</button>
      </div>
      <button class="icon-btn" id="agenda-prev" type="button" aria-label="Anterior">${icon('left')}</button>
      <button class="btn" id="agenda-today" type="button">Hoje</button>
      <button class="icon-btn" id="agenda-next" type="button" aria-label="Próximo">${icon('right')}</button>
      <input class="control" type="date" id="agenda-date" value="${esc(state.date)}" />
      <span class="grow"></span>
      <select class="control" id="agenda-barber">
        <option value="">Todos os profissionais</option>
        ${optionsFrom(
          state.catalog.barbers.filter((barber) => Number(barber.active)),
          state.barberFilter,
          (barber) => barber.name
        )}
      </select>
      <button class="btn btn-primary" id="agenda-new" type="button">${icon('plus')} Novo agendamento</button>
    </div>
    <div id="calendar-holder"></div>
    <div class="legend" style="margin-top:16px">
      <span><i style="background:#d9a441"></i>Aguardando</span>
      <span><i style="background:#43b581"></i>Confirmado</span>
      <span><i style="background:#5b8def"></i>Concluído</span>
      <span><i style="background:rgba(255,255,255,.25)"></i>Cancelado / Não compareceu</span>
      <span><i style="background:var(--gold)"></i>Clique em um horário livre para agendar</span>
    </div>`;

  content().innerHTML = toolbar;
  const holder = document.getElementById('calendar-holder');

  const shift = (days) => {
    state.date = addDays(state.date, state.mode === 'day' ? days : days * 7);
    refresh();
  };

  document.querySelectorAll('#mode-switch button').forEach((element) =>
    element.addEventListener('click', () => {
      state.mode = element.dataset.mode;
      refresh();
    })
  );
  document.getElementById('agenda-prev').addEventListener('click', () => shift(-1));
  document.getElementById('agenda-next').addEventListener('click', () => shift(1));
  document.getElementById('agenda-today').addEventListener('click', () => {
    state.date = todayISO();
    refresh();
  });
  document.getElementById('agenda-date').addEventListener('change', (event) => {
    if (event.target.value) {
      state.date = event.target.value;
      refresh();
    }
  });
  document.getElementById('agenda-barber').addEventListener('change', (event) => {
    state.barberFilter = event.target.value;
    renderCalendar(holder);
  });
  document.getElementById('agenda-new').addEventListener('click', () => {
    openAppointmentForm({ defaults: { date: state.date }, onSaved: refresh });
  });

  await renderCalendar(holder);
}

async function renderCalendar(holder) {
  const barbers = state.catalog.barbers.filter((barber) => Number(barber.active));
  if (!barbers.length) {
    holder.innerHTML = emptyBlock(
      'Nenhum profissional ativo',
      'Cadastre um profissional com horário de trabalho para liberar a agenda.'
    );
    return;
  }

  const days = state.mode === 'week' ? weekDates(state.date) : [state.date];
  const appointments = await api.get(
    `/api/appointments${query({
      from: days[0],
      to: days[days.length - 1],
      barber_id: state.barberFilter || undefined,
    })}`
  );

  const barberOptions = state.barberFilter
    ? barbers.filter((barber) => String(barber.id) === String(state.barberFilter))
    : barbers;
  const weekdays = [...new Set(days.map(weekdayOfISO))];
  const { start: rangeStart, end: rangeEnd } = computeRange(barberOptions, weekdays);
  const rows = Math.max(1, Math.round((rangeEnd - rangeStart) / ROW_MINUTES));

  const columns = state.mode === 'week' ? days : barberOptions;
  const gridTemplate = `grid-template-columns:64px repeat(${columns.length}, minmax(140px, 1fr))`;

  const headCells =
    state.mode === 'week'
      ? days
          .map((iso) => {
            const isToday = iso === todayISO();
            return `<div class="cal-col${isToday ? ' today' : ''}">${esc(WEEKDAYS_SHORT[weekdayOfISO(iso)])}<small>${esc(formatDateBR(iso))}</small></div>`;
          })
          .join('')
      : barberOptions
          .map((barber) => {
            const count = appointments.filter((item) => Number(item.barber_id) === Number(barber.id)).length;
            return `<div class="cal-col">${esc(barber.name)}<small>${count} agendamento(s)</small></div>`;
          })
          .join('');

  const timeColumn = Array.from({ length: rows }, (_, index) => {
    const minutes = rangeStart + index * ROW_MINUTES;
    return `<div class="time-slot">${minutesToHHMM(minutes)}</div>`;
  }).join('');

  const bodyColumns = columns
    .map((column) => {
      const isBarberColumn = state.mode === 'day';
      const columnKey = isBarberColumn ? Number(column.id) : column;
      const items = appointments
        .filter((item) =>
          isBarberColumn ? Number(item.barber_id) === columnKey : item.date === columnKey
        )
        .map((item) => ({
          ...item,
          startMin: hhmmToMinutes(item.start_time),
          endMin: hhmmToMinutes(item.end_time) || hhmmToMinutes(item.start_time) + 30,
        }));

      const { placed, lanes } = layoutLanes(items);
      const blocks = placed.map((item) => blockHtml(item, rangeStart, lanes, !isBarberColumn)).join('');
      const slots = Array.from({ length: rows }, (_, index) => {
        const minutes = rangeStart + index * ROW_MINUTES;
        return `<div class="slot-row" data-time="${minutesToHHMM(minutes)}" data-date="${esc(
          isBarberColumn ? state.date : columnKey
        )}" data-barber="${isBarberColumn ? columnKey : state.barberFilter || ''}"></div>`;
      }).join('');

      return `<div class="${isBarberColumn ? 'barber-col' : 'day-col'}">${slots}${blocks}</div>`;
    })
    .join('');

  holder.innerHTML = `
    <div class="calendar">
      <div class="calendar-head" style="${gridTemplate}">
        <div class="cal-corner"></div>
        ${headCells}
      </div>
      <div class="calendar-body" style="${gridTemplate}">
        <div class="time-col">${timeColumn}</div>
        ${bodyColumns}
      </div>
    </div>`;

  holder.querySelectorAll('.slot-row').forEach((element) =>
    element.addEventListener('click', () => {
      const defaults = { date: element.dataset.date, start_time: element.dataset.time };
      if (element.dataset.barber) defaults.barber_id = Number(element.dataset.barber);
      openAppointmentForm({ defaults, onSaved: refresh });
    })
  );

  holder.querySelectorAll('[data-appt]').forEach((element) =>
    element.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        const appointment = await api.get(`/api/appointments/${element.dataset.appt}`);
        openAppointmentDetails(appointment, { onChanged: refresh });
      } catch (error) {
        toast(error.message, 'error');
      }
    })
  );
}

/* ------------------------------ Agendamentos ------------------------------ */

function defaultAppointmentFilters() {
  return {
    from: todayISO(),
    to: addDays(todayISO(), 30),
    status: '',
    barber_id: '',
    search: '',
  };
}

async function viewAppointments() {
  await loadCatalog();
  const filters = state.appointmentFilters || (state.appointmentFilters = defaultAppointmentFilters());

  content().innerHTML = `
    <div class="toolbar">
      <div class="search-input">
        ${icon('search')}
        <input id="af-search" placeholder="Buscar cliente, telefone ou serviço" value="${esc(filters.search)}" />
      </div>
      <input class="control" type="date" id="af-from" value="${esc(filters.from)}" />
      <input class="control" type="date" id="af-to" value="${esc(filters.to)}" />
      <select class="control" id="af-status">
        <option value="">Todos os status</option>
        ${statusOptions(filters.status)}
      </select>
      <select class="control" id="af-barber">
        <option value="">Todos os profissionais</option>
        ${optionsFrom(state.catalog.barbers, filters.barber_id, (barber) => barber.name)}
      </select>
      <span class="grow"></span>
      <button class="btn btn-sm" id="af-clear" type="button">Limpar</button>
      <button class="btn btn-primary" id="af-new" type="button">${icon('plus')} Novo agendamento</button>
    </div>
    <div id="appointments-holder"></div>`;

  const search = debounce(() => loadAppointmentList(), 340);
  document.getElementById('af-search').addEventListener('input', (event) => {
    filters.search = event.target.value.trim();
    search();
  });
  ['af-from', 'af-to', 'af-status', 'af-barber'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      filters.from = document.getElementById('af-from').value;
      filters.to = document.getElementById('af-to').value;
      filters.status = document.getElementById('af-status').value;
      filters.barber_id = document.getElementById('af-barber').value;
      loadAppointmentList();
    });
  });
  document.getElementById('af-clear').addEventListener('click', () => {
    state.appointmentFilters = defaultAppointmentFilters();
    refresh();
  });
  document.getElementById('af-new').addEventListener('click', () => {
    openAppointmentForm({ defaults: { date: todayISO() }, onSaved: () => loadAppointmentList() });
  });

  await loadAppointmentList();
}

async function loadAppointmentList() {
  const holder = document.getElementById('appointments-holder');
  if (!holder) return;
  const filters = state.appointmentFilters || defaultAppointmentFilters();
  holder.innerHTML = spinnerBlock();

  let rows;
  try {
    rows = await api.get(
      `/api/appointments${query({
        from: filters.from,
        to: filters.to,
        status: filters.status,
        barber_id: filters.barber_id,
        search: filters.search,
      })}`
    );
  } catch (error) {
    holder.innerHTML = emptyBlock('Erro ao buscar agendamentos', error.message);
    return;
  }

  if (!rows.length) {
    holder.innerHTML = `<div class="table-wrap">${emptyBlock(
      'Nenhum agendamento encontrado',
      'Ajuste os filtros ou crie um novo agendamento.'
    )}</div>`;
    return;
  }

  holder.innerHTML = `
    <p class="muted" style="margin-bottom:12px">${rows.length} agendamento(s) encontrado(s).</p>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Data</th><th>Hora</th><th>Cliente</th><th>Serviço</th>
            <th>Profissional</th><th>Valor</th><th>Status</th><th class="actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (item) => `
            <tr>
              <td class="mono">${esc(formatDateBR(item.date))}<div class="cell-sub">${esc(WEEKDAYS_SHORT[weekdayOfISO(item.date)])}</div></td>
              <td class="mono">${esc(item.start_time)}<div class="cell-sub">${esc(item.end_time)}</div></td>
              <td class="cell-strong">${esc(item.client_name)}<div class="cell-sub">${esc(formatPhone(item.client_phone))}</div></td>
              <td>${esc(item.service_name || '-')}</td>
              <td>${esc(item.barber_name)}</td>
              <td class="mono">${esc(money(item.price))}</td>
              <td>${statusPill(item.status)}</td>
              <td class="actions">
                <div class="row-actions" style="justify-content:flex-end">
                  ${
                    item.status === 'pending'
                      ? `<button class="btn btn-ok btn-sm" data-confirm="${item.id}" type="button">${icon('check')} Confirmar</button>`
                      : ''
                  }
                  <button class="btn btn-sm" data-details="${item.id}" type="button">${icon('edit')} Detalhes</button>
                </div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  const openDetails = async (id) => {
    try {
      const appointment = await api.get(`/api/appointments/${id}`);
      openAppointmentDetails(appointment, { onChanged: () => loadAppointmentList() });
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  holder.querySelectorAll('[data-details]').forEach((element) =>
    element.addEventListener('click', () => openDetails(element.dataset.details))
  );
  holder.querySelectorAll('[data-confirm]').forEach((element) =>
    element.addEventListener('click', async () => {
      try {
        await api.patch(`/api/appointments/${element.dataset.confirm}/status`, { status: 'confirmed' });
        toast('Agendamento confirmado.');
        loadAppointmentList();
      } catch (error) {
        toast(error.message, 'error');
      }
    })
  );
}

/* --------------------------------- Clientes ------------------------------- */

async function viewClients() {
  content().innerHTML = `
    <div class="toolbar">
      <div class="search-input">
        ${icon('search')}
        <input id="cl-search" placeholder="Buscar por nome, telefone ou e-mail" />
      </div>
      <span class="grow"></span>
      <button class="btn btn-primary" id="cl-new" type="button">${icon('plus')} Novo cliente</button>
    </div>
    <div id="clients-holder"></div>`;

  document.getElementById('cl-new').addEventListener('click', () => openClientForm(null));
  document.getElementById('cl-search').addEventListener(
    'input',
    debounce((event) => loadClients(event.target.value.trim()), 340)
  );

  await loadClients('');
}

async function loadClients(search) {
  const holder = document.getElementById('clients-holder');
  holder.innerHTML = spinnerBlock();

  let rows;
  try {
    rows = await api.get(`/api/clients${query({ search })}`);
  } catch (error) {
    holder.innerHTML = emptyBlock('Erro ao buscar clientes', error.message);
    return;
  }

  if (!rows.length) {
    holder.innerHTML = `<div class="table-wrap">${emptyBlock(
      'Nenhum cliente cadastrado',
      'Cadastre o primeiro cliente para começar a agendar.'
    )}</div>`;
    return;
  }

  holder.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th>Cliente</th><th>WhatsApp</th><th>E-mail</th><th>Atendimentos</th><th>Última visita</th><th class="actions">Ações</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (client) => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <div class="avatar">${esc(initials(client.name))}</div>
                  <div><span class="cell-strong">${esc(client.name)}</span>${
                    client.notes ? `<div class="cell-sub">${esc(client.notes)}</div>` : ''
                  }</div>
                </div>
              </td>
              <td class="mono">${esc(formatPhone(client.phone))}</td>
              <td class="muted">${esc(client.email || '-')}</td>
              <td class="mono">${Number(client.appointments_total || 0)}</td>
              <td class="mono">${client.last_visit ? esc(formatDateBR(client.last_visit)) : '-'}</td>
              <td class="actions">
                <div class="row-actions" style="justify-content:flex-end">
                  <button class="btn btn-sm" data-history="${client.id}" type="button">${icon('list')} Histórico</button>
                  <button class="btn btn-sm" data-schedule="${client.id}" type="button">${icon('plus')} Agendar</button>
                  <button class="btn btn-sm" data-edit="${client.id}" type="button">${icon('edit')} Editar</button>
                  <button class="btn btn-sm btn-danger" data-del="${client.id}" type="button">${icon('trash')} Excluir</button>
                </div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  holder.querySelectorAll('[data-edit]').forEach((element) =>
    element.addEventListener('click', () => {
      const client = rows.find((item) => Number(item.id) === Number(element.dataset.edit));
      openClientForm(client);
    })
  );
  holder.querySelectorAll('[data-history]').forEach((element) =>
    element.addEventListener('click', () => openClientHistory(element.dataset.history))
  );
  holder.querySelectorAll('[data-schedule]').forEach((element) =>
    element.addEventListener('click', () => {
      openAppointmentForm({
        defaults: { client_id: Number(element.dataset.schedule), date: todayISO() },
        onSaved: () => loadClients(''),
      });
    })
  );
  holder.querySelectorAll('[data-del]').forEach((element) =>
    element.addEventListener('click', async () => {
      const client = rows.find((item) => Number(item.id) === Number(element.dataset.del));
      const confirmed = await confirmDialog({
        title: 'Excluir cliente',
        message: `Excluir ${client.name}? O histórico de agendamentos também será removido.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.del(`/api/clients/${client.id}`);
        toast('Cliente excluído.');
        loadClients('');
      } catch (error) {
        toast(error.message, 'error');
      }
    })
  );
}

function openClientForm(client) {
  const editing = Boolean(client?.id);
  const body = `
    <div class="form-grid">
      <div class="field span-2">
        <label>Nome completo</label>
        <input name="name" value="${esc(client?.name || '')}" placeholder="Nome do cliente" />
      </div>
      <div class="field">
        <label>WhatsApp</label>
        <input name="phone" value="${esc(client?.phone || '')}" placeholder="(11) 99999-9999" />
      </div>
      <div class="field">
        <label>E-mail</label>
        <input name="email" type="email" value="${esc(client?.email || '')}" placeholder="opcional" />
      </div>
      <div class="field">
        <label>Data de nascimento</label>
        <input name="birth_date" type="date" value="${esc(client?.birth_date || '')}" />
      </div>
      <div class="field span-2">
        <label>Observações</label>
        <textarea name="notes" placeholder="Preferências, alergias...">${esc(client?.notes || '')}</textarea>
      </div>
    </div>`;

  const modal = openModal({ title: editing ? 'Editar cliente' : 'Novo cliente', body });
  modal.setFooter([
    button('Cancelar', () => modal.close(), 'btn btn-ghost'),
    button(
      editing ? `${icon('check')} Salvar alterações` : `${icon('plus')} Cadastrar cliente`,
      async (event) => {
        const data = readForm(modal.body);
        if (!data.name) return toast('Informe o nome do cliente.', 'error');
        if (!data.phone) return toast('Informe o WhatsApp.', 'error');
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          if (editing) await api.put(`/api/clients/${client.id}`, data);
          else await api.post('/api/clients', data);
          modal.close();
          toast(editing ? 'Cliente atualizado.' : 'Cliente cadastrado.');
          loadClients('');
        } catch (error) {
          toast(error.message, 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

async function openClientHistory(id) {
  let client;
  try {
    client = await api.get(`/api/clients/${id}`);
  } catch (error) {
    toast(error.message, 'error');
    return;
  }

  const history = client.history || [];
  const body = `
    <div class="grid" style="gap:14px">
      <div class="booking-summary">
        <div><span>Nome</span><strong>${esc(client.name)}</strong></div>
        <div><span>WhatsApp</span><strong>${esc(formatPhone(client.phone))}</strong></div>
        <div><span>E-mail</span><strong>${esc(client.email || '-')}</strong></div>
        <div><span>Atendimentos</span><strong>${Number(client.appointments_total || 0)}</strong></div>
        <div><span>Última visita</span><strong>${client.last_visit ? esc(formatDateBR(client.last_visit)) : '-'}</strong></div>
      </div>
      ${
        history.length
          ? `<div class="table-wrap">
               <table class="data" style="min-width:420px">
                 <thead><tr><th>Data</th><th>Hora</th><th>Serviço</th><th>Profissional</th><th>Valor</th><th>Status</th></tr></thead>
                 <tbody>
                   ${history
                     .map(
                       (item) => `
                     <tr>
                       <td class="mono">${esc(formatDateBR(item.date))}</td>
                       <td class="mono">${esc(item.start_time)}</td>
                       <td>${esc(item.service_name || '-')}</td>
                       <td>${esc(item.barber_name)}</td>
                       <td class="mono">${esc(money(item.price))}</td>
                       <td>${statusPill(item.status)}</td>
                     </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>`
          : emptyBlock('Sem atendimentos registrados')
      }
    </div>`;

  const modal = openModal({ title: 'Histórico do cliente', body });
  modal.setFooter([
    button(`${icon('whatsapp')} WhatsApp`, () => openWhatsapp(client.phone, `Olá ${client.name}! Tudo bem?`), 'btn btn-whats'),
    button('Fechar', () => modal.close(), 'btn btn-primary'),
  ]);
}

/* ------------------------------ Profissionais ----------------------------- */

function hoursSummary(barber) {
  const working = (barber.hours || []).filter((hour) => Number(hour.is_working));
  if (!working.length) return 'Sem dias de atendimento definidos';
  return working
    .map((hour) => `${WEEKDAYS_SHORT[hour.weekday]} ${hour.start_time}-${hour.end_time}`)
    .join(' · ');
}

async function viewBarbers() {
  await loadCatalog(true);
  const barbers = state.catalog.barbers;

  content().innerHTML = `
    <div class="toolbar">
      <span class="grow"></span>
      <button class="btn btn-primary" id="bb-new" type="button">${icon('plus')} Novo profissional</button>
    </div>
    <div id="barbers-holder"></div>`;

  const holder = document.getElementById('barbers-holder');

  if (!barbers.length) {
    holder.innerHTML = `<div class="card">${emptyBlock(
      'Nenhum profissional cadastrado',
      'Cadastre a equipe para liberar a agenda e o agendamento online.'
    )}</div>`;
  } else {
    holder.innerHTML = `<div class="grid grid-3">${barbers
      .map(
        (barber) => `
      <div class="card">
        <div class="card-header">
          <div class="avatar" style="width:44px;height:44px;flex:0 0 44px">${esc(initials(barber.name))}</div>
          <div class="grow">
            <h3>${esc(barber.name)}</h3>
            <div class="card-sub">${Number(barber.active) ? 'Ativo' : 'Inativo'}</div>
          </div>
          ${Number(barber.active) ? '<span class="pill pill-confirmed">Ativo</span>' : '<span class="pill pill-no_show">Inativo</span>'}
        </div>
        <div class="grid" style="gap:8px;font-size:12.5px">
          <div class="muted">${icon('phone', 'inline')} ${esc(formatPhone(barber.phone) || 'Telefone não informado')}</div>
          <div class="muted">${esc(barber.email || 'E-mail não informado')}</div>
          <div class="muted">Comissão: ${esc(String(Number(barber.commission) || 0))}%</div>
          <div class="faint" style="line-height:1.6">${esc(hoursSummary(barber))}</div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-sm" data-hours="${barber.id}" type="button">${icon('clock')} Horários</button>
          <button class="btn btn-sm" data-edit="${barber.id}" type="button">${icon('edit')} Editar</button>
          <button class="btn btn-sm ${Number(barber.active) ? 'btn-danger' : 'btn-ok'}" data-toggle="${barber.id}" type="button">
            ${Number(barber.active) ? 'Desativar' : 'Ativar'}
          </button>
          <button class="btn btn-sm btn-danger" data-del="${barber.id}" type="button">${icon('trash')} Excluir</button>
        </div>
      </div>`
      )
      .join('')}</div>`;
  }

  document.getElementById('bb-new').addEventListener('click', () => openBarberForm(null));

  holder.querySelectorAll('[data-edit]').forEach((element) =>
    element.addEventListener('click', () =>
      openBarberForm(barbers.find((item) => Number(item.id) === Number(element.dataset.edit)))
    )
  );
  holder.querySelectorAll('[data-hours]').forEach((element) =>
    element.addEventListener('click', () =>
      openBarberHours(barbers.find((item) => Number(item.id) === Number(element.dataset.hours)))
    )
  );
  holder.querySelectorAll('[data-toggle]').forEach((element) =>
    element.addEventListener('click', async () => {
      const barber = barbers.find((item) => Number(item.id) === Number(element.dataset.toggle));
      try {
        await api.put(`/api/barbers/${barber.id}`, {
          name: barber.name,
          phone: barber.phone,
          email: barber.email,
          color: barber.color,
          commission: Number(barber.commission) || 0,
          active: !Number(barber.active),
        });
        toast(Number(barber.active) ? 'Profissional desativado.' : 'Profissional ativado.');
        refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    })
  );
  holder.querySelectorAll('[data-del]').forEach((element) =>
    element.addEventListener('click', async () => {
      const barber = barbers.find((item) => Number(item.id) === Number(element.dataset.del));
      const confirmed = await confirmDialog({
        title: 'Excluir profissional',
        message: `Excluir ${barber.name}? Se houver agendamentos, o profissional será apenas desativado.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!confirmed) return;
      try {
        const result = await api.del(`/api/barbers/${barber.id}`);
        toast(result.deactivated ? 'Profissional possui agendamentos e foi desativado.' : 'Profissional excluído.');
        refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    })
  );
}

function openBarberForm(barber) {
  const editing = Boolean(barber?.id);
  const body = `
    <div class="form-grid">
      <div class="field span-2">
        <label>Nome do profissional</label>
        <input name="name" value="${esc(barber?.name || '')}" placeholder="Nome" />
      </div>
      <div class="field">
        <label>Telefone</label>
        <input name="phone" value="${esc(barber?.phone || '')}" />
      </div>
      <div class="field">
        <label>E-mail</label>
        <input name="email" type="email" value="${esc(barber?.email || '')}" />
      </div>
      <div class="field">
        <label>Comissão (%)</label>
        <input name="commission" type="number" min="0" max="100" step="0.5" value="${esc(barber?.commission ?? '')}" />
      </div>
      <div class="field">
        <label>Cor na agenda</label>
        <input name="color" type="color" value="${esc(barber?.color || '#3B82F6')}" />
      </div>
      <label class="field-check">
        <input type="checkbox" name="active" ${!barber || Number(barber.active) ? 'checked' : ''} />
        <span>Profissional ativo</span>
      </label>
    </div>`;

  const modal = openModal({ title: editing ? 'Editar profissional' : 'Novo profissional', body });
  modal.setFooter([
    button('Cancelar', () => modal.close(), 'btn btn-ghost'),
    button(
      editing ? `${icon('check')} Salvar alterações` : `${icon('plus')} Cadastrar`,
      async (event) => {
        const data = readForm(modal.body);
        if (!data.name) return toast('Informe o nome do profissional.', 'error');
        const payload = {
          name: data.name,
          phone: data.phone,
          email: data.email,
          color: data.color,
          commission: data.commission === '' ? 0 : Number(data.commission),
          active: data.active,
        };
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          if (editing) await api.put(`/api/barbers/${barber.id}`, payload);
          else await api.post('/api/barbers', payload);
          modal.close();
          toast(editing ? 'Profissional atualizado.' : 'Profissional cadastrado.');
          refresh();
        } catch (error) {
          toast(error.message, 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

function openBarberHours(barber) {
  const rows = [0, 1, 2, 3, 4, 5, 6]
    .map((weekday) => {
      const hour =
        (barber.hours || []).find((item) => Number(item.weekday) === weekday) || {
          is_working: 0,
          start_time: '09:00',
          end_time: '19:00',
          break_start: '',
          break_end: '',
        };
      return `
        <div class="hours-row">
          <label class="field-check">
            <input type="checkbox" data-w="${weekday}" data-k="is_working" ${Number(hour.is_working) ? 'checked' : ''} />
            <span>${esc(WEEKDAYS_SHORT[weekday])}</span>
          </label>
          <input class="control" type="time" data-w="${weekday}" data-k="start_time" value="${esc(hour.start_time || '09:00')}" />
          <input class="control" type="time" data-w="${weekday}" data-k="end_time" value="${esc(hour.end_time || '19:00')}" />
          <input class="control" type="time" data-w="${weekday}" data-k="break_start" value="${esc(hour.break_start || '')}" />
          <input class="control" type="time" data-w="${weekday}" data-k="break_end" value="${esc(hour.break_end || '')}" />
        </div>`;
    })
    .join('');

  const body = `
    <p class="muted" style="margin-bottom:14px">
      Defina em quais dias e horários <b>${esc(barber.name)}</b> atende. Os horários livres da agenda
      respeitam automaticamente estes limites, o intervalo e as folgas.
    </p>
    <div class="hours-head">
      <span>Dia</span><span>Início</span><span>Fim</span><span>Intervalo início</span><span>Intervalo fim</span>
    </div>
    ${rows}`;

  const modal = openModal({ title: 'Horários de trabalho', body });
  modal.setFooter([
    button('Cancelar', () => modal.close(), 'btn btn-ghost'),
    button(
      `${icon('check')} Salvar horários`,
      async (event) => {
        const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
          const read = (key) =>
            modal.body.querySelector(`[data-w="${weekday}"][data-k="${key}"]`);
          return {
            weekday,
            is_working: read('is_working').checked,
            start_time: read('start_time').value || '09:00',
            end_time: read('end_time').value || '19:00',
            break_start: read('break_start').value || null,
            break_end: read('break_end').value || null,
          };
        });
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          await api.put(`/api/barbers/${barber.id}/hours`, { days });
          modal.close();
          toast('Horários atualizados.');
          refresh();
        } catch (error) {
          toast(error.message, 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

/* --------------------------------- Serviços ------------------------------- */

async function viewServices() {
  await loadCatalog(true);
  const services = state.catalog.services;

  content().innerHTML = `
    <div class="toolbar">
      <span class="grow"></span>
      <button class="btn btn-primary" id="sv-new" type="button">${icon('plus')} Novo serviço</button>
    </div>
    <div id="services-holder"></div>`;

  const holder = document.getElementById('services-holder');

  if (!services.length) {
    holder.innerHTML = `<div class="table-wrap">${emptyBlock(
      'Nenhum serviço cadastrado',
      'Cadastre os serviços com duração e preço para permitir agendamentos.'
    )}</div>`;
  } else {
    holder.innerHTML = `
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Serviço</th><th>Duração</th><th>Preço</th><th>Status</th><th class="actions">Ações</th></tr>
          </thead>
          <tbody>
            ${services
              .map(
                (service) => `
              <tr>
                <td>
                  <span class="cell-strong">${esc(service.name)}</span>
                  ${service.description ? `<div class="cell-sub">${esc(service.description)}</div>` : ''}
                </td>
                <td class="mono">${Number(service.duration_min)} min</td>
                <td class="mono">${esc(money(service.price))}</td>
                <td>${Number(service.active) ? '<span class="pill pill-confirmed">Ativo</span>' : '<span class="pill pill-no_show">Inativo</span>'}</td>
                <td class="actions">
                  <div class="row-actions" style="justify-content:flex-end">
                    <button class="btn btn-sm" data-edit="${service.id}" type="button">${icon('edit')} Editar</button>
                    <button class="btn btn-sm ${Number(service.active) ? 'btn-danger' : 'btn-ok'}" data-toggle="${service.id}" type="button">
                      ${Number(service.active) ? 'Desativar' : 'Ativar'}
                    </button>
                    <button class="btn btn-sm btn-danger" data-del="${service.id}" type="button">${icon('trash')} Excluir</button>
                  </div>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
  }

  document.getElementById('sv-new').addEventListener('click', () => openServiceForm(null));

  holder.querySelectorAll('[data-edit]').forEach((element) =>
    element.addEventListener('click', () =>
      openServiceForm(services.find((item) => Number(item.id) === Number(element.dataset.edit)))
    )
  );
  holder.querySelectorAll('[data-toggle]').forEach((element) =>
    element.addEventListener('click', async () => {
      const service = services.find((item) => Number(item.id) === Number(element.dataset.toggle));
      try {
        await api.put(`/api/services/${service.id}`, {
          name: service.name,
          description: service.description,
          duration_min: Number(service.duration_min),
          price: Number(service.price),
          active: !Number(service.active),
        });
        toast('Serviço atualizado.');
        refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    })
  );
  holder.querySelectorAll('[data-del]').forEach((element) =>
    element.addEventListener('click', async () => {
      const service = services.find((item) => Number(item.id) === Number(element.dataset.del));
      const confirmed = await confirmDialog({
        title: 'Excluir serviço',
        message: `Excluir ${service.name}? Se houver agendamentos, o serviço será apenas desativado.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!confirmed) return;
      try {
        const result = await api.del(`/api/services/${service.id}`);
        toast(result.deactivated ? 'Serviço possui agendamentos e foi desativado.' : 'Serviço excluído.');
        refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    })
  );
}

function openServiceForm(service) {
  const editing = Boolean(service?.id);
  const body = `
    <div class="form-grid">
      <div class="field span-2">
        <label>Nome do serviço</label>
        <input name="name" value="${esc(service?.name || '')}" placeholder="Ex.: Corte masculino" />
      </div>
      <div class="field">
        <label>Duração (minutos)</label>
        <input name="duration_min" type="number" min="5" max="600" step="5" value="${esc(service?.duration_min ?? 30)}" />
      </div>
      <div class="field">
        <label>Preço (R$)</label>
        <input name="price" type="number" min="0" step="0.01" value="${esc(service?.price ?? '')}" placeholder="0,00" />
      </div>
      <div class="field span-2">
        <label>Descrição</label>
        <textarea name="description" placeholder="Detalhes do serviço (opcional)">${esc(service?.description || '')}</textarea>
      </div>
      <label class="field-check">
        <input type="checkbox" name="active" ${!service || Number(service.active) ? 'checked' : ''} />
        <span>Serviço ativo</span>
      </label>
    </div>`;

  const modal = openModal({ title: editing ? 'Editar serviço' : 'Novo serviço', body });
  modal.setFooter([
    button('Cancelar', () => modal.close(), 'btn btn-ghost'),
    button(
      editing ? `${icon('check')} Salvar alterações` : `${icon('plus')} Cadastrar`,
      async (event) => {
        const data = readForm(modal.body);
        if (!data.name) return toast('Informe o nome do serviço.', 'error');
        if (data.price === '') return toast('Informe o preço do serviço.', 'error');
        const payload = {
          name: data.name,
          description: data.description,
          duration_min: Number(data.duration_min || 30),
          price: Number(data.price),
          active: data.active,
        };
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          if (editing) await api.put(`/api/services/${service.id}`, payload);
          else await api.post('/api/services', payload);
          modal.close();
          toast(editing ? 'Serviço atualizado.' : 'Serviço cadastrado.');
          refresh();
        } catch (error) {
          toast(error.message, 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

/* ------------------------------ Configuracoes ----------------------------- */

async function viewSettings() {
  const [settings, businessHours, closures] = await Promise.all([
    api.get('/api/settings'),
    api.get('/api/business-hours'),
    api.get('/api/closures'),
  ]);
  state.settings = settings;

  const saved = (message) => toast(message);

  const businessRows = [0, 1, 2, 3, 4, 5, 6]
    .map((weekday) => {
      const day =
        businessHours.find((item) => Number(item.weekday) === weekday) || {
          is_open: 0,
          open_time: '09:00',
          close_time: '19:00',
          break_start: '',
          break_end: '',
        };
      return `
        <div class="hours-row">
          <label class="field-check">
            <input type="checkbox" data-w="${weekday}" data-k="is_open" ${Number(day.is_open) ? 'checked' : ''} />
            <span>${esc(WEEKDAYS_SHORT[weekday])}</span>
          </label>
          <input class="control" type="time" data-w="${weekday}" data-k="open_time" value="${esc(day.open_time || '09:00')}" />
          <input class="control" type="time" data-w="${weekday}" data-k="close_time" value="${esc(day.close_time || '19:00')}" />
          <input class="control" type="time" data-w="${weekday}" data-k="break_start" value="${esc(day.break_start || '')}" />
          <input class="control" type="time" data-w="${weekday}" data-k="break_end" value="${esc(day.break_end || '')}" />
        </div>`;
    })
    .join('');

  const closuresHtml = closures.length
    ? `<div>${closures
        .map(
          (closure) => `
        <div class="list-row">
          <div class="grow">
            <strong>${esc(formatDateBR(closure.date))}</strong>
            <span>${esc(closure.reason || 'Folga')}</span>
          </div>
          <button class="btn btn-sm btn-danger" data-closure="${closure.id}" type="button">Remover</button>
        </div>`
        )
        .join('')}</div>`
    : emptyBlock('Nenhuma folga cadastrada');

  const publicLink = `${location.origin}/agendar`;

  content().innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><h2>Dados da barbearia</h2></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field">
            <label>Nome exibido</label>
            <input class="control" name="shop_name" value="${esc(settings.shop_name || 'Gestor de Barbearia')}" />
          </div>
          <div class="field">
            <label>Empresa desenvolvedora</label>
            <input class="control" name="shop_company" value="${esc(settings.shop_company || 'Nova Runtime')}" />
          </div>
          <div class="field">
            <label>Telefone</label>
            <input class="control" name="shop_phone" value="${esc(settings.shop_phone || '')}" />
          </div>
          <div class="field">
            <label>WhatsApp da barbearia</label>
            <input class="control" name="shop_whatsapp" value="${esc(settings.shop_whatsapp || '')}" />
          </div>
          <div class="field">
            <label>Endereço</label>
            <input class="control" name="shop_address" value="${esc(settings.shop_address || '')}" />
          </div>
          <div class="field">
            <label>Instagram</label>
            <input class="control" name="shop_instagram" value="${esc(settings.shop_instagram || '')}" />
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="save-shop" type="button">${icon('check')} Salvar dados</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Agendamento online</h2></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <label class="field-check">
            <input type="checkbox" id="public_booking" ${String(settings.public_booking) === '1' ? 'checked' : ''} />
            <span>Permitir que clientes agendem pelo celular</span>
          </label>
          <div class="field">
            <label>Intervalo entre horários (minutos)</label>
            <input class="control" type="number" min="5" max="120" step="5" id="slot_interval" value="${esc(settings.slot_interval || 15)}" />
          </div>
          <div class="field">
            <label>Antecedência mínima (minutos)</label>
            <input class="control" type="number" min="0" max="1440" step="15" id="min_advance_minutes" value="${esc(settings.min_advance_minutes || 0)}" />
          </div>
          <div class="field">
            <label>Antecedência máxima (dias)</label>
            <input class="control" type="number" min="1" max="365" step="1" id="max_advance_days" value="${esc(settings.max_advance_days || 60)}" />
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="save-booking" type="button">${icon('check')} Salvar agendamento</button>
        </div>
        <div class="section-title" style="margin-top:22px">Link para o cliente</div>
        <div class="link-row">
          <div class="code-inline" id="public-link">${esc(publicLink)}</div>
          <button class="btn btn-sm" id="copy-link" type="button">${icon('copy')} Copiar link</button>
          <a class="btn btn-sm" href="/agendar" target="_blank" rel="noopener">${icon('external')} Abrir</a>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <h2>Horário de funcionamento</h2>
        <span class="spacer"></span>
        <button class="btn btn-primary btn-sm" id="save-hours" type="button">${icon('check')} Salvar horários</button>
      </div>
      <div class="hours-head">
        <span>Dia</span><span>Abre</span><span>Fecha</span><span>Intervalo início</span><span>Intervalo fim</span>
      </div>
      ${businessRows}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><h2>Folgas e feriados</h2></div>
        <div class="row-actions" style="margin-bottom:14px">
          <input class="control" type="date" id="closure-date" />
          <input class="control grow" id="closure-reason" placeholder="Motivo (opcional)" />
          <button class="btn btn-primary" id="add-closure" type="button">${icon('plus')} Adicionar folga</button>
        </div>
        ${closuresHtml}
      </div>

      <div class="card">
        <div class="card-header"><h2>Segurança</h2></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field">
            <label>Senha atual</label>
            <input class="control" type="password" id="current_password" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>Nova senha</label>
            <input class="control" type="password" id="new_password" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>Confirmar nova senha</label>
            <input class="control" type="password" id="confirm_password" autocomplete="new-password" />
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="save-password" type="button">${icon('lock')} Alterar senha</button>
        </div>
        <p class="faint" style="margin-top:12px;font-size:12px">
          A senha é armazenada com hash scrypt e a sessão é assinada no servidor.
        </p>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <h2>Mensagens de WhatsApp</h2>
        <span class="spacer"></span>
        <button class="btn btn-primary btn-sm" id="save-templates" type="button">${icon('check')} Salvar mensagens</button>
      </div>
      <p class="muted" style="margin-bottom:14px">
        Variáveis disponíveis: <b>{cliente}</b>, <b>{loja}</b>, <b>{data}</b>, <b>{hora}</b>,
        <b>{barbeiro}</b>, <b>{serviço}</b>. Os botões usam links oficiais do WhatsApp (wa.me).
      </p>
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="field">
          <label>Pedido de confirmação</label>
          <textarea id="tpl_confirmation" placeholder="Olá {cliente}! Aqui é da {loja}. Seu horário está agendado para {data} às {hora} com {barbeiro} ({serviço}). Podemos confirmar?">${esc(settings.whatsapp_message_confirmation || '')}</textarea>
        </div>
        <div class="field">
          <label>Lembrete</label>
          <textarea id="tpl_reminder" placeholder="Oi {cliente}! Lembrete do seu horário na {loja}: {data} às {hora} com {barbeiro}. Esperamos você!">${esc(settings.whatsapp_message_reminder || '')}</textarea>
        </div>
        <div class="field">
          <label>Aviso de cancelamento</label>
          <textarea id="tpl_cancellation" placeholder="Olá {cliente}, seu horário na {loja} em {data} às {hora} foi cancelado. Se quiser, podemos reagendar.">${esc(settings.whatsapp_message_cancellation || '')}</textarea>
        </div>
      </div>
    </div>`;

  const field = (name) => content().querySelector(`[name="${name}"]`);
  const plain = (id) => document.getElementById(id);

  plain('save-shop').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      await api.put('/api/settings', {
        shop_name: field('shop_name').value,
        shop_company: field('shop_company').value,
        shop_phone: field('shop_phone').value,
        shop_whatsapp: field('shop_whatsapp').value,
        shop_address: field('shop_address').value,
        shop_instagram: field('shop_instagram').value,
      });
      saved('Dados da barbearia salvos.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('save-booking').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      await api.put('/api/settings', {
        public_booking: plain('public_booking').checked ? '1' : '0',
        slot_interval: plain('slot_interval').value,
        min_advance_minutes: plain('min_advance_minutes').value,
        max_advance_days: plain('max_advance_days').value,
      });
      saved('Configurações de agendamento salvas.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('save-hours').addEventListener('click', async (event) => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      is_open: content().querySelector(`[data-w="${weekday}"][data-k="is_open"]`).checked,
      open_time: content().querySelector(`[data-w="${weekday}"][data-k="open_time"]`).value || '09:00',
      close_time: content().querySelector(`[data-w="${weekday}"][data-k="close_time"]`).value || '19:00',
      break_start: content().querySelector(`[data-w="${weekday}"][data-k="break_start"]`).value || null,
      break_end: content().querySelector(`[data-w="${weekday}"][data-k="break_end"]`).value || null,
    }));
    setBusy(event.currentTarget, true);
    try {
      await api.put('/api/business-hours', { days });
      saved('Horário de funcionamento salvo.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('add-closure').addEventListener('click', async (event) => {
    const date = plain('closure-date').value;
    if (!date) return toast('Informe a data da folga.', 'error');
    setBusy(event.currentTarget, true);
    try {
      await api.post('/api/closures', { date, reason: plain('closure-reason').value });
      toast('Folga adicionada.');
      refresh();
    } catch (error) {
      toast(error.message, 'error');
      setBusy(event.currentTarget, false);
    }
  });

  content()
    .querySelectorAll('[data-closure]')
    .forEach((element) =>
      element.addEventListener('click', async () => {
        try {
          await api.del(`/api/closures/${element.dataset.closure}`);
          toast('Folga removida.');
          refresh();
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );

  plain('save-password').addEventListener('click', async (event) => {
    const current = plain('current_password').value;
    const next = plain('new_password').value;
    const confirm = plain('confirm_password').value;
    if (!current || !next) return toast('Preencha a senha atual e a nova senha.', 'error');
    if (next !== confirm) return toast('A confirmação da nova senha não confere.', 'error');
    if (next.length < 6) return toast('A nova senha deve ter ao menos 6 caracteres.', 'error');
    setBusy(event.currentTarget, true);
    try {
      await api.post('/api/settings/password', { current_password: current, new_password: next });
      plain('current_password').value = '';
      plain('new_password').value = '';
      plain('confirm_password').value = '';
      saved('Senha alterada com sucesso.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('save-templates').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      await api.put('/api/settings', {
        whatsapp_message_confirmation: plain('tpl_confirmation').value,
        whatsapp_message_reminder: plain('tpl_reminder').value,
        whatsapp_message_cancellation: plain('tpl_cancellation').value,
      });
      saved('Mensagens salvas.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      toast('Link copiado.');
    } catch {
      toast('Não foi possível copiar automaticamente.', 'error');
    }
  });
}

/* -------------------------------- Relatórios ------------------------------ */

function barRow(label, total, max, formatValue) {
  const width = max > 0 ? Math.max(2, Math.round((total / max) * 100)) : 0;
  return `
    <div class="bar-row">
      <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
      <span class="bar-value mono">${formatValue(total)}</span>
    </div>`;
}

function statusTable(byStatus) {
  if (!byStatus.length) return emptyBlock('Nenhum agendamento no período');
  const rows = byStatus
    .slice()
    .sort((a, b) => b.total - a.total)
    .map(
      (row) =>
        `<tr><td>${statusPill(row.status)}</td><td class="mono">${row.total}</td><td class="mono">${esc(money(row.revenue))}</td></tr>`
    )
    .join('');
  return `<table class="data" style="min-width:0"><thead><tr><th>Situação</th><th>Total</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function viewReports() {
  await loadCatalog();

  const initial = state.reportFilters || {
    from: `${todayISO().slice(0, 7)}-01`,
    to: todayISO(),
    barber_id: '',
  };
  state.reportFilters = initial;

  const toolbar = `
    <div class="toolbar">
      <div class="segmented" id="report-range">
        <button type="button" data-range="7">7 dias</button>
        <button type="button" data-range="30">30 dias</button>
        <button type="button" data-range="month">Este mês</button>
      </div>
      <input class="control" type="date" id="report-from" value="${esc(initial.from)}" />
      <span class="faint">até</span>
      <input class="control" type="date" id="report-to" value="${esc(initial.to)}" />
      <select class="control" id="report-barber">
        <option value="">Todos os profissionais</option>
        ${optionsFrom(state.catalog.barbers, initial.barber_id, (barber) => barber.name)}
      </select>
      <span class="grow"></span>
      <button class="btn btn-primary" id="report-refresh" type="button">${icon('chart')} Atualizar</button>
    </div>
    <div id="report-body">${spinnerBlock('Calculando relatórios...')}</div>`;

  content().innerHTML = toolbar;

  const body = document.getElementById('report-body');

  document.querySelectorAll('#report-range button').forEach((element) =>
    element.addEventListener('click', () => {
      const range = element.dataset.range;
      state.reportFilters =
        range === 'month'
          ? { ...state.reportFilters, from: `${todayISO().slice(0, 7)}-01`, to: todayISO() }
          : { ...state.reportFilters, from: addDays(todayISO(), -(Number(range) - 1)), to: todayISO() };
      refresh();
    })
  );

  document.getElementById('report-refresh').addEventListener('click', () => {
    state.reportFilters = {
      from: document.getElementById('report-from').value || todayISO().slice(0, 7) + '-01',
      to: document.getElementById('report-to').value || todayISO(),
      barber_id: document.getElementById('report-barber').value,
    };
    loadReport(body);
  });

  await loadReport(body);
}

async function loadReport(body) {
  const filters = state.reportFilters || { from: todayISO().slice(0, 7) + '-01', to: todayISO() };
  body.innerHTML = spinnerBlock('Calculando relatórios...');

  let report;
  try {
    report = await api.get(
      `/api/reports${query({ from: filters.from, to: filters.to, barber_id: filters.barber_id })}`
    );
  } catch (error) {
    body.innerHTML = emptyBlock('Não foi possível gerar o relatório', error.message);
    return;
  }

  const { totals, range } = report;
  const percent = (value) => `${Math.round(Number(value) * 100)}%`;

  const dailyMax = Math.max(1, ...report.daily.map((day) => day.revenue));
  const weekdayMax = Math.max(1, ...report.by_weekday.map((day) => day.total));
  const serviceMax = Math.max(1, ...report.by_service.map((item) => item.total));

  const dailyBars = report.daily.length
    ? report.daily
        .slice(-31)
        .map((day) => barRow(formatDateBR(day.date), day.revenue, dailyMax, (value) => esc(money(value))))
        .join('')
    : emptyBlock('Sem faturamento registrado no período');

  const weekdayBars = report.by_weekday
    .map((day) => barRow(day.label, day.total, weekdayMax, (value) => String(value)))
    .join('');

  const serviceRows = report.by_service.length
    ? report.by_service
        .map(
          (item) =>
            `<tr><td class="cell-strong">${esc(item.name)}</td><td class="mono">${item.total}</td><td class="mono">${esc(money(item.revenue))}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="3"><div class="empty">Nenhum atendimento no período.</div></td></tr>`;

  const barberRows = report.by_barber.length
    ? report.by_barber
        .map(
          (item) => `
          <tr>
            <td class="cell-strong">${esc(item.name)}<div class="cell-sub">${item.commission_percent}% de comissão</div></td>
            <td class="mono">${item.total}</td>
            <td class="mono">${item.completed}</td>
            <td class="mono">${esc(money(item.realized))}</td>
            <td class="mono gold">${esc(money(item.commission_value))}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="5"><div class="empty">Nenhum atendimento no período.</div></td></tr>`;

  body.innerHTML = `
    <div class="grid grid-kpi">
      ${kpi({ label: 'Agendamentos', value: totals.appointments, iconName: 'calendar', foot: `${range.active_days} dia(s) com movimento` })}
      ${kpi({ label: 'Receita realizada', value: esc(money(totals.revenue_realized)), small: true, iconName: 'wallet', foot: `${totals.completed} concluído(s)` })}
      ${kpi({ label: 'Receita prevista', value: esc(money(totals.revenue_expected)), small: true, iconName: 'chart', foot: 'Exclui cancelados' })}
      ${kpi({ label: 'Ticket médio', value: esc(money(totals.average_ticket)), small: true, iconName: 'sparkles', foot: 'Por atendimento concluído' })}
    </div>

    <div class="grid grid-kpi" style="margin-top:16px">
      ${kpi({ label: 'Taxa de conclusão', value: percent(totals.completion_rate), foot: `${totals.completed} de ${totals.appointments}` })}
      ${kpi({ label: 'Taxa de cancelamento', value: percent(totals.cancellation_rate), foot: `${totals.cancelled} cancelado(s)` })}
      ${kpi({ label: 'Faltas (no-show)', value: percent(totals.no_show_rate), foot: `${totals.no_show} falta(s)` })}
      ${kpi({ label: 'Novos clientes', value: totals.new_clients, foot: 'Cadastrados no período' })}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header">
          <h2>Faturamento por dia</h2>
          <span class="spacer"></span>
          <span class="card-sub">${esc(formatDateBR(range.from))} — ${esc(formatDateBR(range.to))}</span>
        </div>
        <div class="bars">${dailyBars}</div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Movimento por dia da semana</h2>
          <span class="spacer"></span>
          <span class="card-sub">Atendimentos</span>
        </div>
        <div class="bars">${weekdayBars}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <h2>Desempenho por profissional</h2>
        <span class="spacer"></span>
        <span class="card-sub">Comissão calculada sobre a receita realizada</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Profissional</th><th>Total</th><th>Concluídos</th><th>Receita</th><th>Comissão</th></tr></thead>
          <tbody>${barberRows}</tbody>
        </table>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><h2>Serviços mais procurados</h2></div>
        <div class="bars">${
          report.by_service.length
            ? report.by_service
                .map((item) => barRow(item.name, item.total, serviceMax, (value) => String(value)))
                .join('')
            : ''
        }</div>
        <div class="table-wrap" style="margin-top:14px">
          <table class="data" style="min-width:0">
            <thead><tr><th>Serviço</th><th>Total</th><th>Receita</th></tr></thead>
            <tbody>${serviceRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h2>Agendamentos por situação</h2></div>
        <div class="table-wrap">${statusTable(report.by_status)}</div>
      </div>
    </div>

    <p class="faint" style="margin-top:16px;font-size:11.5px">
      Relatório gerado em ${esc(new Date(report.generated_at).toLocaleString('pt-BR'))}.
    </p>`;
}

/* --------------------------------- Backup --------------------------------- */

async function viewBackup() {
  content().innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header">
          <div class="kpi-icon" style="position:static">${icon('download')}</div>
          <div><h3>Exportar dados</h3><div class="card-sub">Arquivo JSON com todas as tabelas</div></div>
        </div>
        <p class="muted">
          Baixe uma cópia completa dos clientes, profissionais, serviços e agendamentos.
          Guarde o arquivo em um lugar seguro: ele permite restaurar o sistema a qualquer momento.
        </p>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="backup-export" type="button">${icon('download')} Baixar backup agora</button>
        </div>
        <div id="backup-meta" style="margin-top:16px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="kpi-icon" style="position:static">${icon('upload')}</div>
          <div><h3>Restaurar backup</h3><div class="card-sub">Importe um arquivo previamente exportado</div></div>
        </div>
        <p class="muted">
          Escolha o arquivo JSON e como aplicar os dados. Use <b>Mesclar</b> para somar aos dados atuais
          ou <b>Substituir</b> para deixar o sistema exatamente como no backup.
        </p>
        <div class="field" style="margin-top:14px">
          <label for="backup-file">Arquivo de backup (.json)</label>
          <input id="backup-file" type="file" accept="application/json,.json" />
        </div>
        <div class="field" style="margin-top:12px">
          <label for="backup-mode">Modo de importação</label>
          <select class="control" id="backup-mode">
            <option value="merge">Mesclar (recomendado)</option>
            <option value="replace">Substituir tudo</option>
          </select>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="backup-import" type="button">${icon('upload')} Importar arquivo</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <h2>Armazenamento e persistência</h2>
        <span class="spacer"></span>
        <button class="btn btn-sm" id="backup-health" type="button">Verificar servidor</button>
      </div>
      <div id="backup-health-box" class="muted" style="font-size:12.5px">
        Clique em "Verificar servidor" para ver o driver de banco em uso e o tempo de atividade.
      </div>
      <p class="faint" style="margin-top:14px;font-size:12px">
        Em produção no plano gratuito do Render o disco é temporário, por isso o sistema usa um banco
        gerenciado na nuvem (Turso/libSQL) quando as variáveis <b>TURSO_DATABASE_URL</b> e
        <b>TURSO_AUTH_TOKEN</b> estão configuradas. Se estiver aparecendo <b>sqlite</b> em produção,
        configure o Turso para não perder dados a cada reinício.
      </p>
    </div>`;

  document.getElementById('backup-export').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Gerando...');
    try {
      const backup = await api.get('/api/backup');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup-barbearia-${todayISO()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      renderBackupMeta(backup.meta);
      toast('Backup baixado com sucesso.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  document.getElementById('backup-import').addEventListener('click', async (event) => {
    const input = document.getElementById('backup-file');
    const mode = document.getElementById('backup-mode').value;
    if (!input.files?.length) return toast('Escolha um arquivo de backup.', 'error');

    let parsed;
    try {
      parsed = JSON.parse(await input.files[0].text());
    } catch {
      return toast('O arquivo selecionado não é um JSON válido.', 'error');
    }

    const confirmed = await confirmDialog({
      title: mode === 'replace' ? 'Substituir todos os dados?' : 'Mesclar backup?',
      message:
        mode === 'replace'
          ? 'Esta ação apaga os dados atuais e restaura apenas o que está no arquivo. Não pode ser desfeita.'
          : 'Os registros do arquivo serão somados aos dados atuais, sobrescrevendo os de mesmo identificador.',
      confirmLabel: mode === 'replace' ? 'Substituir tudo' : 'Importar',
      danger: mode === 'replace',
    });
    if (!confirmed) return;

    setBusy(event.currentTarget, true, 'Importando...');
    try {
      const result = await api.post('/api/backup/import', { mode, data: parsed.data || parsed.backup?.data || parsed });
      const total = Object.values(result.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      toast(`${total} registro(s) restaurado(s).`);
      await loadCatalog(true);
      refresh();
    } catch (error) {
      toast(error.message, 'error');
      setBusy(event.currentTarget, false);
    }
  });

  document.getElementById('backup-health').addEventListener('click', async (event) => {
    const box = document.getElementById('backup-health-box');
    setBusy(event.currentTarget, true, 'Verificando...');
    try {
      const health = await api.get('/health');
      box.innerHTML = `
        <div class="booking-summary">
          <div><span>Status</span><strong>${esc(health.status)}</strong></div>
          <div><span>Banco</span><strong>${esc(health.driver || '-')}</strong></div>
          <div><span>Destino</span><strong>${esc(health.target || '-')}</strong></div>
          <div><span>Ambiente</span><strong>${esc(health.environment || '-')}</strong></div>
          <div><span>Ativo há</span><strong>${Math.round(Number(health.uptime_seconds || 0))}s</strong></div>
        </div>`;
    } catch (error) {
      box.innerHTML = `<span class="muted">${esc(error.message)}</span>`;
    } finally {
      setBusy(event.currentTarget, false);
    }
  });
}

function renderBackupMeta(meta) {
  if (!meta) return;
  const counts = Object.entries(meta.counts || {})
    .map(([table, total]) => `<div><span>${esc(table)}</span><strong class="mono">${Number(total)}</strong></div>`)
    .join('');
  document.getElementById('backup-meta').innerHTML = `
    <div class="booking-summary">
      <div><span>Gerado em</span><strong>${esc(new Date(meta.generated_at).toLocaleString('pt-BR'))}</strong></div>
      <div><span>Banco</span><strong>${esc(meta.driver || '-')}</strong></div>
      ${counts}
    </div>`;
}

/* --------------------------------- Roteador ------------------------------- */

const VIEWS = {
  dashboard: viewDashboard,
  agenda: viewAgenda,
  appointments: viewAppointments,
  clients: viewClients,
  reports: viewReports,
  barbers: viewBarbers,
  services: viewServices,
  settings: viewSettings,
  backup: viewBackup,
};

function currentViewFromHash() {
  const key = (location.hash || '').replace(/^#\/?/, '');
  return NAV.some((item) => item.key === key) ? key : 'dashboard';
}

/* ---------------------------------- Boot ---------------------------------- */

async function startApp() {
  const root = document.getElementById('app');
  root.innerHTML = `<div class="boot-screen"><div class="spinner"></div><span>Preparando o painel...</span></div>`;

  try {
    state.settings = await api.get('/api/settings');
  } catch (error) {
    if (error.status === 401) {
      renderLogin();
      return;
    }
    state.settings = {};
  }

  state.date = todayISO();
  root.innerHTML = shellHtml();
  wireShell();
  await navigate(currentViewFromHash());
}

function boot() {
  const root = document.getElementById('app');
  root.innerHTML = `<div class="boot-screen"><div class="spinner"></div><span>Carregando o Gestor de Barbearia...</span></div>`;
  api
    .get('/api/auth/me')
    .then((me) => {
      state.me = me;
      if (!me.authenticated) {
        renderLogin();
        return;
      }
      return startApp();
    })
    .catch((error) => {
      root.innerHTML = `
        <div class="boot-screen">
          <div class="brand-mark" style="width:52px;height:52px;font-size:17px">GB</div>
          <strong>Não foi possível iniciar o painel</strong>
          <span>${esc(error.message)}</span>
          <button class="btn" id="boot-retry" type="button">Tentar novamente</button>
        </div>`;
      document.getElementById('boot-retry').addEventListener('click', boot);
    });
}

window.addEventListener('hashchange', () => {
  if (!document.getElementById('content')) return;
  navigate(currentViewFromHash());
});

window.addEventListener('appointments:changed', () => {
  if (state.view === 'agenda' || state.view === 'appointments' || state.view === 'dashboard') refresh();
});

boot();
