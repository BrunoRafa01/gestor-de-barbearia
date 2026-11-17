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
import {
  animateAuthScreen,
  animatePanelView,
  animateShellBoot,
  animateSidebarMobileOpen,
  initGsapMotion,
} from './gsap-motion.js';

/* --------------------------------- Estado -------------------------------- */

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Gestão' },
  { key: 'agenda', label: 'Agenda', icon: 'calendar', group: 'Gestão' },
  { key: 'appointments', label: 'Agendamentos', icon: 'list', group: 'Gestão' },
  { key: 'clients', label: 'Clientes', icon: 'users', group: 'Gestão' },
  { key: 'finance', label: 'Financeiro', icon: 'wallet', group: 'Gestão' },
  { key: 'reports', label: 'Relatórios', icon: 'chart', group: 'Gestão' },
  { key: 'marketing', label: 'Divulgação & QR', icon: 'link', group: 'Marketing' },
  { key: 'barbers', label: 'Profissionais', icon: 'scissors', group: 'Cadastros' },
  { key: 'services', label: 'Serviços', icon: 'tag', group: 'Cadastros' },
  { key: 'settings', label: 'Configurações', icon: 'settings', group: 'Sistema' },
  { key: 'backup', label: 'Backup', icon: 'database', group: 'Sistema' },
  { key: 'master', label: 'Painel Master', icon: 'shield', group: 'Nova Runtime', masterOnly: true },
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

/* ---------------------------------- Tema ---------------------------------- */

function getStoredTheme() {
  try {
    return localStorage.getItem('gb_theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function themeIconSvg(theme) {
  if (theme === 'light') {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('gb_theme', next);
  } catch {
    /* ignora */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#F4F6FB' : '#07080B');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = themeIconSvg(next);
    btn.title = next === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro';
    btn.setAttribute('aria-label', btn.title);
  }
  const menuLabel = document.getElementById('menu-theme-label');
  if (menuLabel) {
    menuLabel.textContent = next === 'light' ? 'Tema escuro' : 'Tema claro';
  }
}

function toggleTheme() {
  applyTheme(getStoredTheme() === 'light' ? 'dark' : 'light');
}

applyTheme(getStoredTheme());

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
    <div class="card" style="border-color:var(--gold-line);background:var(--surface)">
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
        ${!state.catalog.services.length ? `<a class="btn" href="#/services">${icon('tag')} Cadastrar serviço</a>` : ''}
        ${!state.catalog.barbers.length ? `<a class="btn" href="#/barbers">${icon('scissors')} Cadastrar profissional</a>` : ''}
        <a class="btn btn-ghost" href="#/settings">${icon('settings')} Configurar funcionamento</a>
      </div>
    </div>`;
}

/** Alerta discreto e unificado no topo do painel (seguranca e/ou demonstracao). */
function topNotices() {
  const parts = [];
  if (state.me?.demo) {
    parts.push('Modo demonstração (dados fictícios)');
  }
  if (state.me?.password_is_default) {
    parts.push('Troque a senha inicial em <a href="#/settings" style="color:var(--accent-2);text-decoration:underline">Configurações</a>');
  }
  if (!parts.length) return '';
  return `
    <div class="notice notice-compact">
      <div class="notice-icon">${icon(state.me?.password_is_default ? 'lock' : 'sparkles')}</div>
      <div class="grow">
        <span>${parts.join(' · ')}</span>
      </div>
    </div>`;
}

/* --------------------------------- Login --------------------------------- */

function readOAuthErrorFromHash() {
  const hash = location.hash || '';
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return '';
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return params.get('oauth_error') || '';
}

function googleIconSvg() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"/>
  </svg>`;
}

function renderLogin() {
  const root = document.getElementById('app');
  const oauthError = readOAuthErrorFromHash();
  const googleEnabled = Boolean(state.me?.oauth_providers?.google);
  const demoMode = Boolean(state.me?.demo);
  root.innerHTML = `
    <div class="page-centered">
      <form class="auth-card" id="login-form">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="8" r="3"/>
              <circle cx="8" cy="24" r="3"/>
              <line x1="26" y1="6" x2="10.5" y2="21.5"/>
              <line x1="18.5" y1="18.5" x2="26" y2="26"/>
              <line x1="10.5" y1="10.5" x2="15" y2="15"/>
              <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <div class="brand-text">
            <strong>Gestor de Barbearia</strong>
            <span>Painel Administrativo</span>
          </div>
        </div>
        <h1>Acesso ao painel</h1>
        <p class="auth-sub">Entre com seu e-mail e senha do painel.</p>
        ${oauthError ? `<div class="auth-alert" role="alert">${esc(oauthError)}</div>` : ''}
        ${
          demoMode
            ? `<a class="btn-oauth" href="/api/auth/demo-session">${icon('sparkles')}<span>Entrar em Modo Demonstração</span></a>
               <div class="auth-divider">ou</div>`
            : ''
        }
        <div class="field">
          <label for="login-email">E-mail (opcional para admin local)</label>
          <input type="email" id="login-email" name="email" autocomplete="email" placeholder="seuemail@barbearia.com" />
        </div>
        <div class="field" style="margin-top:10px">
          <label for="login-password">Senha do painel</label>
          <input type="password" id="login-password" name="password" autocomplete="current-password" placeholder="Digite sua senha" />
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary btn-block" type="submit">Entrar no Sistema</button>
        </div>
        <div class="auth-hint">
          Acesso restrito a contas autorizadas. Senha padrão inicial: <b>admin123</b>.
        </div>
      </form>
    </div>`;

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  animateAuthScreen(root);
  passwordInput.focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    setBusy(submit, true, 'Entrando...');
    try {
      const payload = { password: passwordInput.value };
      const email = emailInput.value.trim();
      if (email) payload.email = email;
      await api.post('/api/auth/login', payload);
      state.me = await api.get('/api/auth/me');
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
  const groups = ['Gestão', 'Cadastros', 'Marketing', 'Sistema', 'Nova Runtime'];
  const navHtml = groups
    .map((group) => {
      const items = NAV.filter((item) => item.group === group && (!item.masterOnly || state.me?.is_master));
      if (!items.length) return '';
      return `<div class="nav-label">${esc(group)}</div>${items.map(navItem).join('')}`;
    })
    .join('');

  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="8" r="3"/>
              <circle cx="8" cy="24" r="3"/>
              <line x1="26" y1="6" x2="10.5" y2="21.5"/>
              <line x1="18.5" y1="18.5" x2="26" y2="26"/>
              <line x1="10.5" y1="10.5" x2="15" y2="15"/>
              <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <div class="brand-text">
            <strong>Gestor de Barbearia</strong>
            <span>Painel da Equipe</span>
          </div>
        </div>
        <nav class="nav">${navHtml}</nav>
        <div class="sidebar-footer">
          <a class="nav-item" href="/master" target="_blank" rel="noopener">${icon('shield')}<span>Painel Master (Dono)</span></a>
          <a class="nav-item" href="/agendar" target="_blank" rel="noopener">${icon('external')}<span>Página de agendamento</span></a>
          <button class="nav-item" type="button" id="logout">${icon('logout')}<span>Sair do painel</span></button>
          <div class="company">Gestor de Barbearia</div>
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
            <button class="icon-btn" id="theme-toggle" type="button" title="${getStoredTheme() === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro'}" aria-label="Alternar tema">${themeIconSvg(getStoredTheme())}</button>
            ${
              state.me?.user?.email
                ? `<div class="user-menu-wrap">
                    <button class="user-pill user-pill-btn" id="user-menu-btn" type="button" aria-expanded="false" title="${esc(state.me.user.email)}">
                      <span class="user-pill-avatar">${esc(state.me.user.email.slice(0, 1).toUpperCase())}</span>
                      <span class="user-pill-label hide-mobile">${esc(state.me.user.email)}</span>
                    </button>
                    <div class="user-menu-dropdown" id="user-menu-dropdown">
                      <div class="user-menu-head">
                        <strong>${esc(state.me.user.email)}</strong>
                        <span>${esc(state.me.user.role === 'owner' ? 'Proprietário / Admin' : state.me.user.role || 'Admin')} · Loja #${esc(String(state.me.user.shop_id || 1))}</span>
                      </div>
                      <button class="user-menu-item" type="button" id="menu-theme-toggle">${themeIconSvg(getStoredTheme())}<span id="menu-theme-label">${getStoredTheme() === 'light' ? 'Tema escuro' : 'Tema claro'}</span></button>
                      <a class="user-menu-item" href="#/reports">${icon('chart')}<span>Relatórios &amp; Caixa</span></a>
                      <a class="user-menu-item" href="#/settings">${icon('settings')}<span>Configurações</span></a>
                      <button class="user-menu-item" type="button" id="topbar-logout">${icon('logout')}<span>Sair do painel</span></button>
                    </div>
                  </div>`
                : ''
            }
            <button class="btn btn-primary" id="quick-new" type="button">${icon('plus')}<span class="hide-mobile">Novo agendamento</span></button>
          </div>
        </header>
        ${topNotices()}
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
    const isOpen = sidebar.classList.toggle('open');
    backdrop.classList.toggle('open');
    if (isOpen) animateSidebarMobileOpen();
  });
  backdrop.addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-item[data-view]').forEach((element) => {
    element.addEventListener('click', closeSidebar);
  });

  document.getElementById('quick-new').addEventListener('click', () => {
    openAppointmentForm({ defaults: { date: state.date }, onSaved: refresh });
  });

  const doLogout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignora */
    }
    location.hash = '';
    renderLogin();
  };

  document.getElementById('logout').addEventListener('click', doLogout);

  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const menuThemeBtn = document.getElementById('menu-theme-toggle');
  if (menuThemeBtn) menuThemeBtn.addEventListener('click', toggleTheme);

  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuDrop = document.getElementById('user-menu-dropdown');
  if (userMenuBtn && userMenuDrop) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = userMenuDrop.classList.toggle('open');
      userMenuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => {
      userMenuDrop.classList.remove('open');
      userMenuBtn.setAttribute('aria-expanded', 'false');
    });
    const topbarLogout = document.getElementById('topbar-logout');
    if (topbarLogout) topbarLogout.addEventListener('click', doLogout);
  }

  if (state.me?.password_is_default && !state.me?.demo) {
    renderForcePasswordScreen();
    return;
  }

  const contentEl = document.getElementById('content');
  if (contentEl && typeof MutationObserver !== 'undefined') {
    let rafId = 0;
    const observer = new MutationObserver(() => {
      if (contentEl.querySelector('.spinner')) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => animatePanelView(contentEl));
    });
    observer.observe(contentEl, { childList: true });
  }
}

function renderForcePasswordScreen() {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div class="page-centered">
      <div class="auth-card" style="max-width:420px;width:100%">
        <h1 style="font-size:20px;margin-bottom:6px">Troca obrigatória de senha</h1>
        <p class="muted" style="font-size:13px;margin-bottom:18px">
          Por segurança, você precisa substituir a senha inicial antes de acessar o painel.
        </p>
        <form id="force-pw-form" class="stack" style="gap:12px">
          <div class="field">
            <label for="fp-current">Senha atual</label>
            <input id="fp-current" type="password" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="fp-new">Nova senha (mín. 8 caracteres, maiúscula, minúscula e número)</label>
            <input id="fp-new" type="password" autocomplete="new-password" required />
          </div>
          <div class="field">
            <label for="fp-confirm">Confirmar nova senha</label>
            <input id="fp-confirm" type="password" autocomplete="new-password" required />
          </div>
          <button class="btn btn-primary btn-block" type="submit">Salvar nova senha e entrar</button>
        </form>
      </div>
    </div>`;

  document.getElementById('force-pw-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const current_password = document.getElementById('fp-current').value;
    const new_password = document.getElementById('fp-new').value;
    const confirm = document.getElementById('fp-confirm').value;
    if (new_password !== confirm) {
      toast('As senhas novas não coincidem.', 'error');
      return;
    }
    try {
      await api.post('/api/settings/password', { current_password, new_password });
      state.me.password_is_default = false;
      toast('Senha atualizada com sucesso!', 'success');
      boot();
    } catch (error) {
      toast(error.message || 'Erro ao atualizar senha.', 'error');
    }
  });
}

/* ------------------------------- Navegacao -------------------------------- */

const TITLES = {
  dashboard: 'Dashboard',
  agenda: 'Agenda',
  appointments: 'Agendamentos',
  clients: 'Clientes',
  finance: 'Financeiro & Caixa',
  reports: 'Relatórios',
  marketing: 'Divulgação & QR Code',
  barbers: 'Profissionais',
  services: 'Serviços',
  settings: 'Configurações',
  backup: 'Backup e dados',
  master: 'Torre de Controle — Nova Runtime',
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
    case 'finance':
      return 'Receitas, despesas, comissões, formas de pagamento e fechamento de caixa.';
    case 'reports':
      return 'Faturamento, ocupação e desempenho por período.';
    case 'marketing':
      return 'Divulgue sua barbearia no Instagram, imprima QR Codes e gere cartão digital.';
    case 'barbers':
      return 'Equipe, comissões e horários de trabalho.';
    case 'services':
      return 'Serviços, duração e preços.';
    case 'settings':
      return 'Funcionamento, folgas, WhatsApp e segurança.';
    case 'backup':
      return 'Exporte, restaure e proteja os dados da barbearia.';
    case 'master':
      return 'Visão executiva multiempresa, assinaturas, planos e saúde da plataforma.';
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
    if (error.status === 403 && String(error.message || '').toLowerCase().includes('senha')) {
      renderForcePasswordScreen();
      return;
    }
    content().innerHTML = emptyBlock('Nao foi possivel carregar esta tela', error.message);
  }
}

/* -------------------------------- Dashboard ------------------------------- */

function resolveDashboardRange(rangeKey, refDate) {
  const to = refDate || todayISO();
  if (rangeKey === 'today') return { from: to, to, label: 'Hoje' };
  if (rangeKey === '7d') return { from: addDays(to, -6), to, label: 'Últimos 7 dias' };
  if (rangeKey === 'month') return { from: `${to.slice(0, 7)}-01`, to, label: 'Mês Atual' };
  return { from: addDays(to, -29), to, label: 'Últimos 30 dias' };
}

function buildSparklineSvg(dailyRows) {
  const values = (dailyRows && dailyRows.length ? dailyRows.slice(-10) : [{ revenue: 0 }, { revenue: 0 }]).map((d) =>
    Number(d.revenue || d.revenue_expected || 0)
  );
  if (values.length === 1) values.unshift(values[0]);
  const max = Math.max(1, ...values);
  const w = 68;
  const h = 24;
  const pts = values.map((v, i) => [
    Number(((i / Math.max(1, values.length - 1)) * w).toFixed(1)),
    Number((h - 3 - (v / max) * (h - 6)).toFixed(1)),
  ]);
  const line = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return `
    <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="flex-shrink:0;display:block">
      <path d="${area}" fill="rgba(16, 185, 129, 0.14)" />
      <path d="${line}" fill="none" stroke="#10B981" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
}

async function viewDashboard() {
  await loadCatalog();
  state.dashRange = state.dashRange || '30d';
  state.dashStatusFilter = state.dashStatusFilter || 'all';
  state.dashSearch = state.dashSearch || '';

  const range = resolveDashboardRange(state.dashRange, state.date);
  const [data, report, billing, waStatus, health] = await Promise.all([
    api.get(`/api/dashboard${query({ date: state.date })}`),
    api.get(`/api/reports${query({ from: range.from, to: range.to })}`).catch(() => null),
    api.get('/api/billing/plan').catch(() => null),
    api.get('/api/whatsapp/config').catch(() => null),
    fetch('/health').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const { today } = data;
  const rate = today.occupancy.rate;
  const occupancyPct = rate === null ? 0 : Math.max(0, Math.min(100, Number(rate)));
  const totals = report?.totals || {
    appointments: today.total,
    completed: today.completed,
    cancelled: today.cancelled,
    no_show: today.no_show,
    pending: today.pending,
    confirmed: today.confirmed,
    revenue_realized: today.revenue_realized,
    revenue_expected: today.revenue_expected,
    average_ticket: data.month?.average_ticket || 0,
    cancellation_rate: 0,
    no_show_rate: 0,
    completion_rate: 0,
    new_clients: data.month?.new_clients || 0,
    returning_clients: 0,
    repeat_rate: 0,
  };
  const growthPct = Number(report?.comparison?.revenue_growth_pct || 0);
  const realizedRatio = totals.revenue_expected > 0
    ? Math.min(100, Math.round((totals.revenue_realized / totals.revenue_expected) * 100))
    : 0;
  const cancelTotal = Number(totals.cancelled || 0) + Number(totals.no_show || 0);
  const cancelRate = totals.appointments > 0 ? Math.round((cancelTotal / totals.appointments) * 100) : 0;
  const totalClientsPeriod = Number(totals.new_clients || 0) + Number(totals.returning_clients || 0);
  const repeatPct = Math.round(Number(totals.repeat_rate || 0) * 100);

  const funnelSteps = [
    { label: 'Agendados no período', count: totals.appointments, pct: totals.appointments > 0 ? 100 : 0 },
    {
      label: 'Confirmados e concluídos',
      count: Number(totals.confirmed || 0) + Number(totals.completed || 0),
      pct: totals.appointments > 0 ? Math.round(((Number(totals.confirmed || 0) + Number(totals.completed || 0)) / totals.appointments) * 100) : 0,
    },
    {
      label: 'Atendimentos concluídos',
      count: totals.completed,
      pct: totals.appointments > 0 ? Math.round((totals.completed / totals.appointments) * 100) : 0,
    },
    {
      label: 'Clientes recorrentes',
      count: totals.returning_clients || 0,
      pct: totalClientsPeriod > 0 ? repeatPct : 0,
    },
  ];

  const topServices = (report?.by_service?.length ? report.by_service : data.top_services || []).slice(0, 4);
  const topBarbers = (report?.by_barber?.length ? report.by_barber : data.top_barbers || []).slice(0, 4);

  const filterAppts = (list) => {
    const term = state.dashSearch.trim().toLowerCase();
    return list.filter((item) => {
      if (state.dashStatusFilter === 'confirmed' && item.status !== 'confirmed') return false;
      if (state.dashStatusFilter === 'completed' && item.status !== 'completed') return false;
      if (state.dashStatusFilter === 'pending' && item.status !== 'pending') return false;
      if (state.dashStatusFilter === 'cancelled' && !['cancelled', 'no_show'].includes(item.status)) return false;
      if (!term) return true;
      return `${item.client_name} ${item.service_name || ''} ${item.barber_name || ''}`.toLowerCase().includes(term);
    });
  };
  const filteredDayAppts = filterAppts(today.appointments || []);

  const planName = billing?.plan?.name || 'Plano Gratuito';
  const activeBarbers = billing?.usage?.active_barbers ?? today.occupancy.barbers;
  const maxBarbers = billing?.plan?.max_barbers;
  const barberCapLabel = maxBarbers ? `${activeBarbers} / ${maxBarbers} profissionais` : `${activeBarbers} profissionais`;
  const waConnected = Boolean(waStatus?.is_configured && waStatus?.enabled);
  const dbEngine = health?.driver === 'turso' ? 'Turso Cloud (libSQL)' : 'SQLite Local';

  const notice = onboardingNotice();

  content().innerHTML = `
    ${notice}
    <div class="ct-header">
      <div>
        <h2 class="ct-title">Visão Geral</h2>
        <p class="ct-sub">${esc(state.me?.shop_name || 'Gestor de Barbearia')} · ${esc(range.label)}</p>
      </div>
      <div class="ct-controls">
        <div class="ct-segmented" role="tablist" aria-label="Período do painel">
          ${[
            ['today', 'Hoje'],
            ['7d', '7d'],
            ['30d', '30d'],
            ['month', 'Mês atual'],
          ]
            .map(
              ([key, lbl]) =>
                `<button type="button" class="ct-seg-btn ${state.dashRange === key ? 'active' : ''}" data-range="${key}">${lbl}</button>`
            )
            .join('')}
        </div>
        <button type="button" class="btn btn-sm" id="ct-export-csv"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Exportar CSV</span></button>
        <button type="button" class="btn btn-primary btn-sm" id="ct-new-appt">${icon('plus')}<span>Novo agendamento</span></button>
      </div>
    </div>

    <section class="ct-kpi-grid" aria-label="Indicadores principais">
      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Receita prevista</div>
            <div class="ct-card-sub">${esc(range.label)}</div>
          </div>
          <span class="ct-pill">${growthPct >= 0 ? `+${growthPct}%` : `${growthPct}%`}</span>
        </div>
        <div class="ct-spark-row">
          <div class="ct-kpi-val mono">${esc(money(totals.revenue_expected))}</div>
          ${buildSparklineSvg(report?.daily)}
        </div>
        <div class="ct-kpi-foot">
          <span>Hoje: <strong class="mono">${esc(money(today.revenue_expected))}</strong></span>
          <span>Realizado: <strong class="mono">${realizedRatio}%</strong></span>
        </div>
      </article>

      <article class="ct-card ct-card-accent">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Receita realizada</div>
            <div class="ct-card-sub">Atendimentos concluídos</div>
          </div>
          <span class="ct-pill is-blue">${realizedRatio}% do previsto</span>
        </div>
        <div class="ct-kpi-val mono">${esc(money(totals.revenue_realized))}</div>
        <div class="ct-kpi-foot">
          <span>Ticket médio: <strong class="mono">${esc(money(totals.average_ticket))}</strong></span>
          <span>${totals.completed} atend.</span>
        </div>
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Atendimentos</div>
            <div class="ct-card-sub">${totals.completed} concluídos · ${totals.pending + totals.confirmed} em aberto</div>
          </div>
          <span class="ct-pill ${rate === null ? 'is-muted' : 'is-blue'}">${rate === null ? 'Fechado' : `Ocup. ${occupancyPct}%`}</span>
        </div>
        <div class="ct-kpi-val mono">${totals.appointments}</div>
        <div class="ct-bar-track"><div class="ct-bar-fill" style="width:${rate === null ? 0 : occupancyPct}%"></div></div>
        <div class="ct-kpi-foot">
          <span>Novos clientes: <strong class="mono">${totals.new_clients}</strong></span>
          <span>${esc(barberCapLabel)}</span>
        </div>
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Cancelamentos e faltas</div>
            <div class="ct-card-sub">Sobre o total do período</div>
          </div>
          <span class="ct-pill ${cancelRate <= 8 ? 'is-muted' : 'is-warn'}">${cancelRate <= 8 ? 'Normal' : 'Alto'}</span>
        </div>
        <div class="ct-kpi-val mono">${cancelRate}%</div>
        <div class="ct-kpi-foot">
          <span>${totals.cancelled} cancelado(s)</span>
          <span>${totals.no_show} falta(s)</span>
        </div>
      </article>
    </section>

    <section class="ct-mid-grid" aria-label="Conversão, serviços e sistema">
      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Conversão no período</div>
            <div class="ct-card-sub">Do agendamento ao retorno</div>
          </div>
        </div>
        <div class="ct-funnel">
          ${funnelSteps
            .map(
              (step) => `
              <div class="ct-funnel-row">
                <div class="ct-funnel-top">
                  <span>${esc(step.label)}</span>
                  <strong class="mono">${step.count} (${step.pct}%)</strong>
                </div>
                <div class="ct-bar-track"><div class="ct-bar-fill" style="width:${Math.min(100, step.pct)}%"></div></div>
              </div>`
            )
            .join('')}
        </div>
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Serviços mais pedidos</div>
            <div class="ct-card-sub">Faturamento por serviço</div>
          </div>
          <a href="#/reports" style="font-size:12px;color:#60A5FA;text-decoration:none">Ver relatório</a>
        </div>
        <div class="ct-rank-list">
          ${
            topServices.length
              ? topServices
                  .map(
                    (srv, idx) => `
                <div class="ct-rank-item">
                  <span><span class="ct-rank-pos">${idx + 1}.</span>${esc(srv.name)}</span>
                  <strong class="mono">${srv.total} · ${esc(money(srv.revenue))}</strong>
                </div>`
                  )
                  .join('')
              : `<div class="empty">Nenhum serviço concluído neste período.</div>`
          }
          ${
            topBarbers.length
              ? `<div style="font-size:11.5px;color:var(--text-faint);padding-top:10px">Equipe: ${topBarbers
                  .slice(0, 2)
                  .map((b) => `<strong style="color:var(--text)">${esc(b.name)}</strong> (${esc(money(b.revenue))})`)
                  .join(' · ')}</div>`
              : ''
          }
        </div>
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Status do sistema</div>
            <div class="ct-card-sub">Banco, WhatsApp e assinatura</div>
          </div>
          <span class="ct-pill">${health?.status === 'ok' ? 'Online' : 'Ativo'}</span>
        </div>
        <div class="ct-infra-list">
          <div class="ct-infra-item">
            <div>
              <strong>Banco de dados</strong>
              <span>${esc(dbEngine)}</span>
            </div>
            <span class="ct-pill">Conectado</span>
          </div>
          <div class="ct-infra-item">
            <div>
              <strong>WhatsApp Cloud API</strong>
              <span>${waConnected ? 'Disparos e lembretes ativos' : 'Credenciais pendentes'}</span>
            </div>
            <span class="ct-pill ${waConnected ? '' : 'is-warn'}">${waConnected ? 'Ativo' : 'Pendente'}</span>
          </div>
          <div class="ct-infra-item">
            <div>
              <strong>${esc(planName)}</strong>
              <span>${esc(barberCapLabel)}</span>
            </div>
            <a href="#/settings" class="ct-pill is-blue" style="text-decoration:none">Configurar</a>
          </div>
        </div>
      </article>
    </section>

    <article class="card ct-table-card">
      <div class="card-header" style="flex-wrap:wrap;gap:12px">
        <div>
          <h2>Agenda de ${esc(formatDateBR(state.date))}</h2>
          <p class="card-sub">Horários marcados para o dia selecionado</p>
        </div>
        <span class="spacer"></span>
        <div class="toolbar">
          <button class="icon-btn" id="dash-prev" type="button" aria-label="Dia anterior">${icon('left')}</button>
          <button class="btn btn-sm" id="dash-today" type="button">Hoje</button>
          <button class="icon-btn" id="dash-next" type="button" aria-label="Próximo dia">${icon('right')}</button>
          <input class="control" type="date" id="dash-date" value="${esc(state.date)}" />
          <button class="btn btn-sm" id="dash-open-agenda" type="button">Abrir grade</button>
        </div>
      </div>

      <div class="ct-table-toolbar" style="margin-bottom:12px">
        <div class="ct-filter-pills">
          ${[
            ['all', `Todos (${today.total})`],
            ['confirmed', `Confirmados (${today.confirmed})`],
            ['completed', `Concluídos (${today.completed})`],
            ['pending', `Aguardando (${today.pending})`],
            ['cancelled', `Canc./Faltas (${today.cancelled + today.no_show})`],
          ]
            .map(
              ([key, label]) =>
                `<button type="button" class="ct-filter-pill ${state.dashStatusFilter === key ? 'active' : ''}" data-status-filter="${key}">${label}</button>`
            )
            .join('')}
        </div>
        <input class="control" type="search" id="ct-search-appt" value="${esc(state.dashSearch)}" placeholder="Buscar na agenda..." style="min-width:220px" />
      </div>

      <div id="ct-agenda-body">
      ${
        filteredDayAppts.length
          ? `<div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Horário</th>
                    <th>Cliente</th>
                    <th>Serviço</th>
                    <th>Profissional</th>
                    <th>Valor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredDayAppts
                    .map(
                      (item) => `
                    <tr data-appt="${item.id}" style="cursor:pointer">
                      <td class="mono"><strong>${esc(item.start_time)}</strong></td>
                      <td><strong>${esc(item.client_name)}</strong></td>
                      <td>${esc(item.service_name || 'Serviço')}</td>
                      <td>${esc(item.barber_name)}</td>
                      <td class="mono">${esc(money(item.price))}</td>
                      <td>${statusPill(item.status)}</td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : rate === null
            ? emptyBlock('Barbearia fechada neste dia', 'Não há expediente configurado para esta data.')
            : emptyBlock('Nenhum agendamento encontrado', 'Ajuste os filtros acima ou clique em "+ Novo Agendamento".')
      }
      </div>
    </article>`;

  const bindRowClicks = (rootEl) => {
    rootEl.querySelectorAll('[data-appt]').forEach((element) =>
      element.addEventListener('click', async () => {
        try {
          const appointment = await api.get(`/api/appointments/${element.dataset.appt}`);
          openAppointmentDetails(appointment, { onChanged: refresh });
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
  };

  const renderAgendaTableOnly = () => {
    const host = document.getElementById('ct-agenda-body');
    if (!host) return;
    const rows = filterAppts(today.appointments || []);
    host.innerHTML = rows.length
      ? `<div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Horário</th>
                <th>Cliente</th>
                <th>Serviço</th>
                <th>Profissional</th>
                <th>Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (item) => `
                <tr data-appt="${item.id}" style="cursor:pointer">
                  <td class="mono"><strong>${esc(item.start_time)}</strong></td>
                  <td><strong>${esc(item.client_name)}</strong></td>
                  <td>${esc(item.service_name || 'Serviço')}</td>
                  <td>${esc(item.barber_name)}</td>
                  <td class="mono">${esc(money(item.price))}</td>
                  <td>${statusPill(item.status)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`
      : rate === null
        ? emptyBlock('Barbearia fechada neste dia', 'Não há expediente configurado para esta data.')
        : emptyBlock('Nenhum agendamento encontrado', 'Ajuste os filtros acima ou clique em "+ Novo Agendamento".');
    bindRowClicks(host);
  };

  content()
    .querySelectorAll('[data-range]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        state.dashRange = btn.dataset.range;
        refresh();
      })
    );

  content()
    .querySelectorAll('[data-status-filter]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        state.dashStatusFilter = btn.dataset.statusFilter;
        content()
          .querySelectorAll('[data-status-filter]')
          .forEach((el) => el.classList.toggle('active', el.dataset.statusFilter === state.dashStatusFilter));
        renderAgendaTableOnly();
      })
    );

  const searchEl = document.getElementById('ct-search-appt');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      state.dashSearch = e.target.value;
      renderAgendaTableOnly();
    });
  }

  const ctNewAppt = document.getElementById('ct-new-appt');
  if (ctNewAppt) {
    ctNewAppt.addEventListener('click', () => {
      openAppointmentForm({ defaults: { date: state.date }, onSaved: refresh });
    });
  }

  const exportBtn = document.getElementById('ct-export-csv');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const rows = [
        ['Data', 'Horario', 'Cliente', 'Servico', 'Profissional', 'Valor', 'Status'],
        ...(today.appointments || []).map((a) => [
          a.date,
          a.start_time,
          a.client_name,
          a.service_name || '',
          a.barber_name || '',
          String(a.price || 0),
          a.status,
        ]),
      ];
      const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agenda-${state.date}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast('CSV exportado com sucesso!', 'ok');
    });
  }

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

function formatDateTimeBR(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return String(iso);
  }
}

function renderWhatsAppHistoryTable(messages) {
  if (!messages || !messages.length) {
    return `<div class="empty-block" style="padding:24px; text-align:center; color:var(--text-dim)">Nenhuma mensagem registrada até o momento.</div>`;
  }
  const typeLabels = {
    confirmation: 'Confirmação',
    reminder: 'Lembrete 24h',
    cancellation: 'Cancelamento',
    reschedule: 'Reagendamento',
    team_alert: 'Alerta Equipe',
    test: 'Teste Manual',
  };
  const statusBadges = {
    sent: '<span class="pill pill-confirmed">Enviado</span>',
    delivered: '<span class="pill pill-completed">Entregue</span>',
    read: '<span class="pill pill-confirmed" style="background:rgba(52,211,153,0.22)">Lido</span>',
    pending: '<span class="pill pill-pending">Pendente</span>',
    failed: '<span class="pill pill-cancelled">Falhou</span>',
  };
  return `
    <table class="table" style="width:100%; border-collapse:collapse">
      <thead>
        <tr>
          <th>Data / Hora</th>
          <th>Tipo</th>
          <th>Destinatário</th>
          <th>Agendamento</th>
          <th>Status</th>
          <th>Ações / Detalhes</th>
        </tr>
      </thead>
      <tbody>
        ${messages.map((msg) => `
          <tr>
            <td class="mono" style="font-size:12px; white-space:nowrap">${esc(formatDateTimeBR(msg.created_at))}</td>
            <td><strong>${esc(typeLabels[msg.message_type] || msg.message_type)}</strong></td>
            <td>
              <div>${esc(msg.recipient_name || 'Destinatário')}</div>
              <div class="mono muted" style="font-size:11px">${esc(formatPhone(msg.recipient_phone))}</div>
            </td>
            <td>
              ${msg.appointment_id ? `
                <div style="font-size:12px">#${esc(msg.appointment_id)} - ${esc(msg.client_name || '')}</div>
                <div class="muted" style="font-size:11px">${msg.appointment_date ? esc(formatDateBR(msg.appointment_date)) : ''} ${esc(msg.appointment_time || '')}</div>
              ` : '<span class="muted">-</span>'}
            </td>
            <td>${statusBadges[msg.status] || `<span class="pill pill-neutral">${esc(msg.status)}</span>`}</td>
            <td>
              ${msg.error_message ? `
                <div style="color:#f87171; font-size:11px; max-width:260px; word-break:break-word" title="${esc(msg.error_message)}">
                  ${esc(msg.error_message.slice(0, 95))}
                </div>
              ` : ''}
              ${msg.meta_message_id ? `
                <div class="mono muted" style="font-size:10px" title="ID da Meta: ${esc(msg.meta_message_id)}">
                  ID: ${esc(msg.meta_message_id.slice(0, 16))}...
                </div>
              ` : ''}
              ${msg.status === 'failed' ? `
                <button class="btn btn-sm btn-ghost resend-wa-btn" data-id="${msg.id}" type="button" style="margin-top:4px; font-size:11px; padding:2px 8px">
                  Reenviar
                </button>
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

async function viewSettings() {
  const [settings, businessHours, closures, waConfig, waMessages] = await Promise.all([
    api.get('/api/settings'),
    api.get('/api/business-hours'),
    api.get('/api/closures'),
    api.get('/api/whatsapp/config').catch(() => null),
    api.get('/api/whatsapp/messages?limit=25').catch(() => []),
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
      const isOpen = Boolean(Number(day.is_open));
      return `
        <div class="hours-row" data-hours-row="${weekday}" style="${isOpen ? '' : 'opacity:0.65'}">
          <label class="field-check" style="gap:8px">
            <input type="checkbox" data-w="${weekday}" data-k="is_open" ${isOpen ? 'checked' : ''} />
            <span>${esc(WEEKDAYS_SHORT[weekday])}</span>
            <span class="pill ${isOpen ? 'pill-confirmed' : 'pill-cancelled'}" data-w-badge="${weekday}" style="font-size:10.5px;padding:2px 7px">${isOpen ? 'Aberto' : 'Folga'}</span>
          </label>
          <input class="control" type="time" data-w="${weekday}" data-k="open_time" value="${esc(day.open_time || '09:00')}" ${isOpen ? '' : 'disabled'} />
          <input class="control" type="time" data-w="${weekday}" data-k="close_time" value="${esc(day.close_time || '19:00')}" ${isOpen ? '' : 'disabled'} />
          <input class="control" type="time" data-w="${weekday}" data-k="break_start" value="${esc(day.break_start || '')}" ${isOpen ? '' : 'disabled'} />
          <input class="control" type="time" data-w="${weekday}" data-k="break_end" value="${esc(day.break_end || '')}" ${isOpen ? '' : 'disabled'} />
        </div>`;
    })
    .join('');

  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const todayHasClosure = closures.some((c) => c.date === today);

  const closuresHtml = closures.length
    ? `<div>${closures
        .map(
          (closure) => `
        <div class="list-row">
          <div class="grow" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>${esc(formatDateBR(closure.date))}</strong>
            ${closure.date === today ? '<span class="pill pill-cancelled" style="font-size:10.5px">Hoje</span>' : ''}
            <span class="muted">${esc(closure.reason || 'Folga')}</span>
          </div>
          <button class="btn btn-sm btn-danger" data-closure="${closure.id}" type="button">Remover folga</button>
        </div>`
        )
        .join('')}</div>`
    : emptyBlock('Nenhuma folga ou feriado cadastrado');

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
            <label>Nome da empresa ou rede</label>
            <input class="control" name="shop_company" value="${esc(settings.shop_company || 'Barbearia & Barber Shop')}" />
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
      <div class="card-header" style="flex-wrap:wrap;gap:10px">
        <div>
          <h2>Horário de funcionamento &amp; Folga Semanal</h2>
          <div class="card-sub">Desmarque os dias da semana em que a barbearia fica de folga (fechada)</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" type="button" data-hours-preset="mon-sat">Seg–Sáb (Dom Folga)</button>
        <button class="btn btn-ghost btn-sm" type="button" data-hours-preset="tue-sat">Ter–Sáb (Dom/Seg Folga)</button>
        <button class="btn btn-ghost btn-sm" type="button" data-hours-preset="all-open">Abrir Todos os Dias</button>
        <button class="btn btn-primary btn-sm" id="save-hours" type="button">${icon('check')} Salvar horários e folgas</button>
      </div>
      <div class="hours-head">
        <span>Dia / Status</span><span>Abre</span><span>Fecha</span><span>Intervalo início</span><span>Intervalo fim</span>
      </div>
      ${businessRows}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:8px">
          <div>
            <h2>Dias de Folga, Feriados &amp; Fechamento</h2>
            <div class="card-sub">Bloqueie datas específicas e atualize o status "Fechado hoje" na página de agendamento</div>
          </div>
        </div>
        <div class="row-actions" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm ${todayHasClosure ? 'btn-ghost' : 'btn-danger'}" id="quick-close-today" type="button" ${todayHasClosure ? 'disabled' : ''}>
            ${icon('ban')} ${todayHasClosure ? 'Hoje já está marcado como Folga' : 'Fechar Hoje (Folga Hoje)'}
          </button>
          <button class="btn btn-sm btn-ghost" id="quick-close-tomorrow" type="button">
            ${icon('calendar')} Fechar Amanhã (${esc(formatDateBR(tomorrow))})
          </button>
        </div>
        <div class="row-actions" style="margin-bottom:14px">
          <input class="control" type="date" id="closure-date" value="${esc(today)}" />
          <input class="control grow" id="closure-reason" placeholder="Motivo (ex: Folga, Feriado, Reforma)" />
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
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div>
          <h2>WhatsApp Business Cloud API (Oficial da Meta)</h2>
          <div class="card-sub">Envio 100% automático e oficial de confirmações, lembretes de 24h e cancelamentos</div>
        </div>
        <span class="spacer"></span>
        <span class="pill ${waConfig?.configured ? 'pill-confirmed' : 'pill-pending'}">
          ${waConfig?.configured ? (waConfig?.enabled ? 'Ativo e Operacional' : 'Configurado (Pausado)') : 'Não Configurado'}
        </span>
        <button class="btn btn-ghost btn-sm" id="test-whatsapp-cloud" type="button" style="margin-left:8px">
          ${icon('whatsapp')} Testar Envio
        </button>
        <button class="btn btn-ghost btn-sm" id="trigger-reminders-now" type="button">
          ${icon('clock')} Disparar Lembretes 24h
        </button>
        <button class="btn btn-primary btn-sm" id="save-whatsapp-cloud" type="button">
          ${icon('check')} Salvar WhatsApp
        </button>
      </div>

      <div style="margin-top:12px; margin-bottom:16px; padding:12px; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-soft)">
        <label class="field-check">
          <input type="checkbox" id="whatsapp_cloud_enabled" ${waConfig?.enabled ? 'checked' : ''} />
          <strong>Ativar envio automático oficial via WhatsApp Business Cloud API</strong>
        </label>
        <div class="muted" style="margin-top:4px; font-size:12px">
          Ao ativar, o sistema enviará as mensagens diretamente pelos servidores oficiais da Meta sem abrir o WhatsApp Web ou o app do celular.
        </div>
      </div>

      <div class="grid grid-2" style="gap:16px">
        <div>
          <h3 style="font-size:14px; margin-bottom:12px; color:var(--text-main)">Credenciais da Meta</h3>
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="field">
              <label>Phone Number ID (ID do número na Meta)</label>
              <input class="control mono" id="whatsapp_phone_number_id" value="${esc(waConfig?.phone_number_id || '')}" placeholder="Ex: 104829384910293" />
            </div>
            <div class="field">
              <label>WhatsApp Business Account ID (WABA ID)</label>
              <input class="control mono" id="whatsapp_business_account_id" value="${esc(waConfig?.business_account_id || '')}" placeholder="Ex: 109283746192837" />
            </div>
            <div class="field">
              <label>Token de Acesso Permanente (System User Token)</label>
              <input class="control mono" type="password" id="whatsapp_access_token" placeholder="${waConfig?.has_access_token ? '•••••••••••• (já configurado — deixe em branco para manter)' : 'Cole o token de acesso Bearer da Meta'}" />
              <div class="muted" style="font-size:11px; margin-top:2px">
                ${waConfig?.has_access_token ? '<span style="color:#34d399">✔ Token armazenado com segurança no servidor</span>' : 'Nunca exposto no frontend ou navegador'}
              </div>
            </div>
            <div class="field">
              <label>Versão da Graph API</label>
              <input class="control mono" id="whatsapp_api_version" value="${esc(waConfig?.api_version || 'v21.0')}" placeholder="v21.0" />
            </div>
          </div>
        </div>

        <div>
          <h3 style="font-size:14px; margin-bottom:12px; color:var(--text-main)">Notificações e Lembretes</h3>
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="field">
              <label>WhatsApp do Administrador (para alertas de equipe)</label>
              <input class="control" id="whatsapp_admin_phone" value="${esc(waConfig?.admin_phone || '')}" placeholder="Ex: 11999999999" />
            </div>
            <label class="field-check">
              <input type="checkbox" id="whatsapp_notify_admin" ${waConfig?.notify_admin ? 'checked' : ''} />
              <span>Notificar administrador em novos agendamentos</span>
            </label>
            <label class="field-check">
              <input type="checkbox" id="whatsapp_notify_barber" ${waConfig?.notify_barber ? 'checked' : ''} />
              <span>Notificar barbeiro responsável em novos agendamentos</span>
            </label>
            <div style="display:flex; gap:10px; align-items:center; margin-top:8px">
              <label class="field-check" style="flex:1">
                <input type="checkbox" id="whatsapp_reminder_enabled" ${waConfig?.reminder_enabled ? 'checked' : ''} />
                <span>Enviar lembrete automático</span>
              </label>
              <div style="display:flex; align-items:center; gap:6px">
                <input class="control mono" style="width:70px" type="number" min="1" max="72" id="whatsapp_reminder_hours" value="${esc(waConfig?.reminder_hours || 24)}" />
                <span class="muted" style="font-size:12px">horas antes</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border-soft)">
        <h3 style="font-size:14px; margin-bottom:8px">Modelos de Mensagem (Templates) da Meta</h3>
        <p class="muted" style="margin-bottom:12px; font-size:12px">
          Para mensagens de lembrete iniciadas pela barbearia fora da janela de 24 horas, a Meta exige templates pré-aprovados.
        </p>
        <div style="margin-bottom:12px">
          <label class="field-check">
            <input type="checkbox" id="whatsapp_use_templates" ${waConfig?.use_templates ? 'checked' : ''} />
            <span>Utilizar templates da Meta (se desmarcado, envia mensagens de texto padrão)</span>
          </label>
        </div>
        <div class="grid grid-2" style="gap:12px">
          <div class="field">
            <label>Template Confirmação</label>
            <input class="control mono" id="whatsapp_template_confirmation" value="${esc(waConfig?.templates?.confirmation || 'confirmacao_agendamento')}" />
          </div>
          <div class="field">
            <label>Template Lembrete 24h</label>
            <input class="control mono" id="whatsapp_template_reminder" value="${esc(waConfig?.templates?.reminder || 'lembrete_agendamento')}" />
          </div>
          <div class="field">
            <label>Template Cancelamento</label>
            <input class="control mono" id="whatsapp_template_cancellation" value="${esc(waConfig?.templates?.cancellation || 'cancelamento_agendamento')}" />
          </div>
          <div class="field">
            <label>Template Reagendamento</label>
            <input class="control mono" id="whatsapp_template_reschedule" value="${esc(waConfig?.templates?.reschedule || 'reagendamento_agendamento')}" />
          </div>
        </div>
      </div>

      <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border-soft)">
        <h3 style="font-size:14px; margin-bottom:6px">Webhook da Meta (Recibos de Entrega e Leitura)</h3>
        <p class="muted" style="margin-bottom:10px; font-size:12px">
          Configure este endereço no painel do Meta for Developers para receber status em tempo real de entrega (enviado, entregue, lido):
        </p>
        <div class="grid grid-2" style="gap:12px">
          <div class="field">
            <label>URL de Retorno (Callback URL)</label>
            <input class="control mono" readonly value="${esc(waConfig?.webhook_callback_url || `${location.origin}/api/whatsapp/webhook`)}" />
          </div>
          <div class="field">
            <label>Token de Verificação (Verify Token)</label>
            <input class="control mono" type="password" id="whatsapp_webhook_verify_token" placeholder="${waConfig?.has_webhook_token ? '•••••••••••• (configurado)' : 'Defina um segredo alfanumérico'}" />
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div>
          <h2>Histórico e Auditoria de Mensagens do WhatsApp</h2>
          <div class="card-sub">Registro de envios, confirmações de entrega, leituras e tratamento de falhas</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" id="refresh-whatsapp-history" type="button">
          ${icon('clock')} Atualizar Histórico
        </button>
      </div>

      <div class="table-wrap" id="whatsapp-history-wrap" style="margin-top:12px">
        ${renderWhatsAppHistoryTable(waMessages)}
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

  const syncWeekdayRowState = (weekday) => {
    const chk = content().querySelector(`[data-w="${weekday}"][data-k="is_open"]`);
    const row = content().querySelector(`[data-hours-row="${weekday}"]`);
    const badge = content().querySelector(`[data-w-badge="${weekday}"]`);
    if (!chk) return;
    const open = chk.checked;
    if (row) row.style.opacity = open ? '1' : '0.65';
    if (badge) {
      badge.textContent = open ? 'Aberto' : 'Folga';
      badge.className = `pill ${open ? 'pill-confirmed' : 'pill-cancelled'}`;
    }
    content()
      .querySelectorAll(`[data-w="${weekday}"]:not([data-k="is_open"])`)
      .forEach((inp) => {
        inp.disabled = !open;
      });
  };

  [0, 1, 2, 3, 4, 5, 6].forEach((weekday) => {
    content()
      .querySelector(`[data-w="${weekday}"][data-k="is_open"]`)
      ?.addEventListener('change', () => syncWeekdayRowState(weekday));
  });

  content()
    .querySelectorAll('[data-hours-preset]')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.hoursPreset;
        [0, 1, 2, 3, 4, 5, 6].forEach((weekday) => {
          const chk = content().querySelector(`[data-w="${weekday}"][data-k="is_open"]`);
          if (!chk) return;
          if (preset === 'mon-sat') chk.checked = weekday >= 1 && weekday <= 6;
          else if (preset === 'tue-sat') chk.checked = weekday >= 2 && weekday <= 6;
          else if (preset === 'all-open') chk.checked = true;
          syncWeekdayRowState(weekday);
        });
        toast('Predefinição aplicada. Clique em "Salvar horários e folgas" para gravar.');
      });
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
      saved('Horários e folgas semanais salvos com sucesso.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  const createClosureWithConfirm = async (date, reason, triggerBtn) => {
    if (!date) return toast('Informe a data da folga.', 'error');
    if (triggerBtn) setBusy(triggerBtn, true);
    try {
      await api.post('/api/closures', { date, reason });
      toast('Dia de folga registrado com sucesso.');
      refresh();
    } catch (error) {
      if (triggerBtn) setBusy(triggerBtn, false);
      if (error.status === 409 && String(error.message || '').toLowerCase().includes('agendamentos ativos')) {
        const confirmed = await confirmDialog({
          title: 'Existem agendamentos nesta data',
          message: `${error.message} Deseja cancelar esses agendamentos automaticamente e registrar a folga mesmo assim?`,
          confirmLabel: 'Cancelar agendamentos e fechar dia',
          danger: true,
        });
        if (confirmed) {
          try {
            await api.post('/api/closures', { date, reason, force: true });
            toast('Folga registrada e agendamentos do dia cancelados.');
            refresh();
          } catch (err2) {
            toast(err2.message, 'error');
          }
        }
        return;
      }
      toast(error.message, 'error');
    }
  };

  plain('add-closure').addEventListener('click', (event) => {
    createClosureWithConfirm(plain('closure-date').value, plain('closure-reason').value || 'Folga', event.currentTarget);
  });

  plain('quick-close-today')?.addEventListener('click', (event) => {
    createClosureWithConfirm(today, plain('closure-reason').value || 'Folga hoje', event.currentTarget);
  });

  plain('quick-close-tomorrow')?.addEventListener('click', (event) => {
    createClosureWithConfirm(tomorrow, plain('closure-reason').value || 'Folga programada', event.currentTarget);
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
    if (next.length < 8) return toast('A nova senha deve ter ao menos 8 caracteres (maiúscula, minúscula e número).', 'error');
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

  plain('save-whatsapp-cloud')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      const payload = {
        whatsapp_cloud_enabled: plain('whatsapp_cloud_enabled').checked ? '1' : '0',
        whatsapp_phone_number_id: plain('whatsapp_phone_number_id').value.trim(),
        whatsapp_business_account_id: plain('whatsapp_business_account_id').value.trim(),
        whatsapp_api_version: plain('whatsapp_api_version').value.trim(),
        whatsapp_admin_phone: plain('whatsapp_admin_phone').value.trim(),
        whatsapp_notify_admin: plain('whatsapp_notify_admin').checked ? '1' : '0',
        whatsapp_notify_barber: plain('whatsapp_notify_barber').checked ? '1' : '0',
        whatsapp_reminder_enabled: plain('whatsapp_reminder_enabled').checked ? '1' : '0',
        whatsapp_reminder_hours: plain('whatsapp_reminder_hours').value.trim() || '24',
        whatsapp_use_templates: plain('whatsapp_use_templates').checked ? '1' : '0',
        whatsapp_template_confirmation: plain('whatsapp_template_confirmation').value.trim(),
        whatsapp_template_reminder: plain('whatsapp_template_reminder').value.trim(),
        whatsapp_template_cancellation: plain('whatsapp_template_cancellation').value.trim(),
        whatsapp_template_reschedule: plain('whatsapp_template_reschedule').value.trim(),
      };
      const token = plain('whatsapp_access_token').value.trim();
      if (token) payload.whatsapp_access_token = token;
      const webhookToken = plain('whatsapp_webhook_verify_token').value.trim();
      if (webhookToken) payload.whatsapp_webhook_verify_token = webhookToken;

      await api.put('/api/settings', payload);
      saved('Configurações do WhatsApp Cloud salvas com sucesso.');
      refresh();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('trigger-reminders-now')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      const res = await api.post('/api/whatsapp/trigger-reminders', {});
      toast(`Verificação concluída: ${res.sent} enviados, ${res.scanned} agendamentos analisados.`);
      const updatedMessages = await api.get('/api/whatsapp/messages?limit=25');
      const wrap = plain('whatsapp-history-wrap');
      if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('refresh-whatsapp-history')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      const updatedMessages = await api.get('/api/whatsapp/messages?limit=25');
      const wrap = plain('whatsapp-history-wrap');
      if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
      toast('Histórico atualizado.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(event.currentTarget, false);
    }
  });

  plain('test-whatsapp-cloud')?.addEventListener('click', () => {
    const defaultPhone = plain('whatsapp_admin_phone')?.value || plain('whatsapp_phone_number_id')?.value || '';
    const modalContent = document.createElement('div');
    modalContent.innerHTML = `
      <p class="muted" style="margin-bottom:12px; font-size:13px">
        O sistema enviará uma mensagem direta através da Meta WhatsApp Business Cloud API para o número especificado.
      </p>
      <div class="field" style="margin-bottom:12px">
        <label>Telefone do Destinatário (com DDD)</label>
        <input class="control" id="modal-test-phone" value="${esc(defaultPhone)}" placeholder="Ex: 11999998888" />
      </div>
      <div class="field" style="margin-bottom:14px">
        <label>Texto da Mensagem</label>
        <textarea class="control" id="modal-test-message" rows="3">Mensagem de teste oficial enviada via Meta WhatsApp Business Cloud API - Gestor de Barbearia.</textarea>
      </div>
      <div id="test-result-box" style="display:none; margin-bottom:14px; padding:10px; border-radius:6px; font-size:12px; font-family:monospace; white-space:pre-wrap; max-height:160px; overflow-y:auto"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px">
        <button class="btn btn-ghost" id="modal-test-cancel" type="button">Cancelar</button>
        <button class="btn btn-primary" id="modal-test-send" type="button">${icon('whatsapp')} Enviar Teste</button>
      </div>
    `;

    const modal = openModal({
      title: 'Testar Conexão com WhatsApp Meta',
      body: modalContent,
    });

    modalContent.querySelector('#modal-test-cancel').addEventListener('click', () => modal.close());
    modalContent.querySelector('#modal-test-send').addEventListener('click', async (evt) => {
      const phone = modalContent.querySelector('#modal-test-phone').value.trim();
      const message = modalContent.querySelector('#modal-test-message').value.trim();
      const resultBox = modalContent.querySelector('#test-result-box');
      if (!phone) return toast('Informe o telefone de destino.', 'error');

      setBusy(evt.currentTarget, true);
      resultBox.style.display = 'none';
      try {
        const res = await api.post('/api/whatsapp/test', { phone, message });
        resultBox.style.display = 'block';
        resultBox.style.background = 'rgba(16, 185, 129, 0.1)';
        resultBox.style.color = '#34d399';
        resultBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        resultBox.textContent = `SUCESSO!\nID da Mensagem Meta: ${res.meta_message_id || 'OK'}\nResposta: ${JSON.stringify(res, null, 2)}`;
        toast('Mensagem de teste enviada com sucesso!');
        const updatedMessages = await api.get('/api/whatsapp/messages?limit=25');
        const wrap = plain('whatsapp-history-wrap');
        if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
      } catch (err) {
        resultBox.style.display = 'block';
        resultBox.style.background = 'rgba(239, 68, 68, 0.1)';
        resultBox.style.color = '#f87171';
        resultBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        resultBox.textContent = `FALHA NO ENVIO:\n${err.message}\n${err.details ? JSON.stringify(err.details, null, 2) : ''}`;
        toast(err.message, 'error');
      } finally {
        setBusy(evt.currentTarget, false);
      }
    });
  });

  plain('whatsapp-history-wrap')?.addEventListener('click', async (e) => {
    const resendBtn = e.target.closest('.resend-wa-btn');
    if (!resendBtn) return;
    const msgId = resendBtn.dataset.id;
    if (!msgId) return;
    setBusy(resendBtn, true);
    try {
      await api.post(`/api/whatsapp/resend/${msgId}`, {});
      toast('Tentativa de reenvio realizada.');
      const updatedMessages = await api.get('/api/whatsapp/messages?limit=25');
      const wrap = plain('whatsapp-history-wrap');
      if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(resendBtn, false);
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
      <button class="btn btn-ghost" id="report-export-csv" type="button">${icon('clipboard')} Exportar CSV</button>
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

  document.getElementById('report-export-csv')?.addEventListener('click', async () => {
    try {
      const filters = state.reportFilters || { from: todayISO().slice(0, 7) + '-01', to: todayISO() };
      const report = await api.get(`/api/reports${query({ from: filters.from, to: filters.to, barber_id: filters.barber_id })}`);
      const rows = [
        ['Profissional', 'Total Atendimentos', 'Concluidos', 'Receita Realizada (R$)', 'Comissao (R$)'],
        ...report.by_barber.map((b) => [b.name, b.total, b.completed, Number(b.realized).toFixed(2), Number(b.commission_value).toFixed(2)]),
      ];
      const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(';')).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `relatorio-financeiro-${filters.from}-a-${filters.to}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast('Relatório exportado em CSV com sucesso!', 'ok');
    } catch (err) {
      toast('Erro ao exportar: ' + err.message, 'error');
    }
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

  const totalCommissions = report.by_barber.reduce((sum, b) => sum + Number(b.commission_value || 0), 0);
  const netHouse = Math.max(0, Number(totals.revenue_realized || 0) - totalCommissions);

  const barberCards = report.by_barber.length
    ? report.by_barber
        .map(
          (item) => `
          <div class="barber-repasse-card">
            <div class="barber-repasse-head">
              <div class="barber-repasse-id">
                <div class="avatar">${esc(initials(item.name))}</div>
                <div>
                  <div style="font-weight:600;color:#DEE2F0">${esc(item.name)}</div>
                  <div style="font-size:11.5px;color:#4CD7F6">${item.completed} concluído(s)</div>
                </div>
              </div>
              <span class="barber-repasse-badge">${item.commission_percent}% Comissão</span>
            </div>
            <div class="barber-repasse-metrics">
              <div>
                <span>Faturamento Bruto</span>
                <strong>${esc(money(item.realized))}</strong>
              </div>
              <div>
                <span>Comissão Total</span>
                <strong class="text-blue-accent">${esc(money(item.commission_value))}</strong>
              </div>
            </div>
            <div class="barber-repasse-foot">
              <span>${item.total} atendimento(s) no período</span>
              <span class="text-emerald-accent">Repasse calculado</span>
            </div>
          </div>`
        )
        .join('')
    : emptyBlock('Nenhum profissional com atendimentos no período');

  body.innerHTML = `
    <div class="grid grid-kpi">
      ${kpi({ label: 'Receita Realizada', value: esc(money(totals.revenue_realized)), small: true, iconName: 'wallet', foot: `${totals.completed} atendimento(s) concluído(s)` })}
      <div class="stitch-kpi-cyan">${kpi({ label: 'Receita Prevista', value: esc(money(totals.revenue_expected)), small: true, iconName: 'chart', foot: `${totals.appointments} agendamento(s) ativos` })}</div>
      <div class="stitch-kpi-blue">${kpi({ label: 'Comissões a Pagar', value: esc(money(totalCommissions)), small: true, iconName: 'users', foot: 'Repasse total da equipe' })}</div>
      <div class="stitch-kpi-emerald">${kpi({ label: 'Saldo Líquido da Casa', value: esc(money(netHouse)), small: true, iconName: 'sparkles', foot: 'Receita livre de comissões' })}</div>
    </div>

    <div class="grid grid-kpi" style="margin-top:14px">
      ${kpi({ label: 'Ticket médio', value: esc(money(totals.average_ticket)), small: true, foot: 'Por atendimento concluído' })}
      ${kpi({ label: 'Taxa de conclusão', value: percent(totals.completion_rate), foot: `${totals.completed} de ${totals.appointments}` })}
      ${kpi({ label: 'Taxa de cancelamento', value: percent(totals.cancellation_rate), foot: `${totals.cancelled} cancelado(s)` })}
      ${kpi({ label: 'Novos clientes', value: totals.new_clients, foot: `${totals.no_show} falta(s) no período` })}
    </div>

    <div style="margin-top:20px">
      <div class="card-header" style="margin-bottom:12px">
        <h2>Repasse por Barbeiro & Performance Individual</h2>
        <span class="spacer"></span>
        <span class="card-sub">Taxas individuais calculadas sobre receita realizada</span>
      </div>
      <div class="grid grid-3">${barberCards}</div>
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

/* --------------------------- Divulgacao & Marketing ----------------------- */

function renderQrSvg(text, sizePx = 180) {
  // Compact ISO/IEC 18004 QR Code (Byte mode, EC Level L, Versions 1..6)
  const dataBytes = Array.from(new TextEncoder().encode(String(text)));
  const VERSIONS = [
    { v: 1, total: 26, data: 19, ec: 7, align: [] },
    { v: 2, total: 44, data: 34, ec: 10, align: [6, 18] },
    { v: 3, total: 70, data: 55, ec: 15, align: [6, 22] },
    { v: 4, total: 100, data: 80, ec: 20, align: [6, 26] },
    { v: 5, total: 134, data: 108, ec: 26, align: [6, 30] },
    { v: 6, total: 172, data: 136, ec: 36, align: [6, 34] },
  ];
  const ver = VERSIONS.find((item) => dataBytes.length + 2 <= item.data) || VERSIONS[VERSIONS.length - 1];
  const maxBytes = ver.data - 2;
  const payload = dataBytes.slice(0, maxBytes);
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);
  const capBits = ver.data * 8;
  pushBits(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  let padIdx = 0;
  while (codewords.length < ver.data) {
    codewords.push(padIdx % 2 === 0 ? 0xec : 0x11);
    padIdx += 1;
  }

  // GF(256) Reed-Solomon
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : gfExp[gfLog[a] + gfLog[b]]);

  // Single-block RS generator for Versions 1..5 (Ver 6 uses 2 blocks; split cleanly if needed)
  const calcEc = (dataArr, ecLen) => {
    let gen = [1];
    for (let i = 0; i < ecLen; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= gfMul(gen[j], gfExp[i]);
      }
      gen = next;
    }
    const rem = new Array(ecLen).fill(0);
    for (const d of dataArr) {
      const factor = d ^ rem[0];
      rem.shift();
      rem.push(0);
      if (factor !== 0) {
        for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
      }
    }
    return rem;
  };

  let fullStream;
  if (ver.v <= 5) {
    fullStream = [...codewords, ...calcEc(codewords, ver.ec)];
  } else {
    // Version 6-L: 2 blocks of 68 data + 18 EC each
    const b1 = codewords.slice(0, 68);
    const b2 = codewords.slice(68, 136);
    const ec1 = calcEc(b1, 18);
    const ec2 = calcEc(b2, 18);
    fullStream = [];
    for (let i = 0; i < 68; i++) fullStream.push(b1[i], b2[i]);
    for (let i = 0; i < 18; i++) fullStream.push(ec1[i], ec2[i]);
  }

  const size = ver.v * 4 + 17;
  const grid = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFixed = (r, c, val) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = val;
      reserved[r][c] = 1;
    }
  };
  const placeFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inBox = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFixed(r0 + r, c0 + c, inBox && (onBorder || inCore) ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  if (ver.align.length) {
    const pos = ver.align[1];
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const val = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0) ? 1 : 0;
        setFixed(pos + r, pos + c, val);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    setFixed(6, i, i % 2 === 0 ? 1 : 0);
    setFixed(i, 6, i % 2 === 0 ? 1 : 0);
  }
  setFixed(4 * ver.v + 9, 8, 1);

  // Reserve format info cells
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }

  // Place data bits (mask 0: (r + c) % 2 === 0)
  const streamBits = [];
  for (const byte of fullStream) {
    for (let i = 7; i >= 0; i--) streamBits.push((byte >>> i) & 1);
  }
  let bitIdx = 0;
  let dir = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step++) {
      const r = dir === -1 ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (!reserved[r][c]) {
          const bit = bitIdx < streamBits.length ? streamBits[bitIdx++] : 0;
          grid[r][c] = (r + c) % 2 === 0 ? bit ^ 1 : bit;
        }
      }
    }
    dir = -dir;
  }

  // Format info for EC Level L (01) + Mask 0 (000) -> 15-bit BCH = 0x77c4
  const fmtBits = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const bit = (fmtBits >>> (14 - i)) & 1;
    if (i < 6) grid[8][i] = bit;
    else if (i < 8) grid[8][i + 1] = bit;
    else grid[size - 15 + i][8] = bit;

    if (i < 8) grid[size - 1 - i][8] = bit;
    else if (i < 9) grid[7][8] = bit;
    else grid[14 - i][8] = bit;
  }

  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === 1) {
        rects += `<rect x="${c + 2}" y="${r + 2}" width="1" height="1" fill="#080B12"/>`;
      }
    }
  }
  const vb = size + 4;
  return `<svg viewBox="0 0 ${vb} ${vb}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" style="background:#FFFFFF;border-radius:12px" aria-label="QR Code para agendamento">${rects}</svg>`;
}

async function viewMarketing() {
  const shopName = state.settings.shop_name || 'Nova Barbearia';
  const shopPhone = state.settings.shop_whatsapp || state.settings.shop_phone || '';
  const shopAddress = state.settings.shop_address || 'Av. Modelo, 100, Cidade Fictícia - SP';
  const shopInstagram = state.settings.shop_instagram || '@novabarbearia.oficial';
  const publicUrl = `${window.location.origin}/agendar`;
  const customShopUrl = `${window.location.origin}/b/nova-barbearia`;

  const qrSvg = renderQrSvg(publicUrl, 180);

  content().innerHTML = `
    <div class="grid grid-2">
      <!-- Card Link da Bio do Instagram -->
      <div class="card">
        <div class="card-header">
          <h2>Link de Agendamento da Bio</h2>
          <span class="card-sub">Instagram &bull; WhatsApp &bull; TikTok</span>
        </div>
        <p class="muted" style="font-size:13px;line-height:1.5">
          Coloque este link na biografia do seu Instagram para receber agendamentos diretamente pelo celular dos clientes:
        </p>

        <div class="field" style="margin-top:14px">
          <label>Link Direto Oficial</label>
          <div style="display:flex;gap:8px">
            <input class="control mono" id="mkt-url" readonly value="${esc(publicUrl)}" style="flex:1" />
            <button class="btn btn-primary" id="btn-copy-url" type="button">${icon('clipboard')} Copiar</button>
          </div>
        </div>

        <div class="field" style="margin-top:14px">
          <label>Link Personalizado Multi-barbearia</label>
          <div style="display:flex;gap:8px">
            <input class="control mono" id="mkt-tenant-url" readonly value="${esc(customShopUrl)}" style="flex:1" />
            <button class="btn" id="btn-copy-tenant" type="button">${icon('clipboard')} Copiar</button>
          </div>
        </div>

        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn-ghost" href="${esc(publicUrl)}" target="_blank" rel="noopener">
            ${icon('calendar')} Abrir Página Pública &rarr;
          </a>
          <button class="btn btn-whats" id="btn-share-wa" type="button">
            ${icon('whatsapp')} Compartilhar no WhatsApp
          </button>
        </div>
      </div>

      <!-- Card QR Code de Balcão e Bancada -->
      <div class="card" style="text-align:center">
        <div class="card-header">
          <h2>QR Code para Balcão e Espelho</h2>
          <span class="card-sub">Material Físico</span>
        </div>
        <p class="muted" style="font-size:13px;text-align:center;margin-bottom:16px">
          Imprima este QR Code em acrílico ou adesivo para seus clientes marcarem o próximo horário antes de sair da cadeira.
        </p>

        <div style="display:inline-block;padding:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.4)">
          ${qrSvg}
        </div>

        <div style="margin-top:20px;display:flex;justify-content:center;gap:10px">
          <button class="btn btn-primary" id="btn-print-qr" type="button">
            ${icon('printer')} Imprimir Display para Balcão
          </button>
        </div>
      </div>
    </div>

    <!-- Card Cartao Digital da Barbearia -->
    <div class="grid grid-2" style="margin-top:20px">
      <div class="card">
        <div class="card-header">
          <h2>Cartão Digital Interativo</h2>
          <span class="card-sub">Perfeito para enviar no WhatsApp e Stories</span>
        </div>
        <div style="max-width:320px;margin:16px auto;background:linear-gradient(145deg, #101622 0%, #141C2D 100%);border:1px solid var(--border);border-radius:20px;padding:24px;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,0.5)">
          <div style="width:56px;height:56px;margin:0 auto 12px;background:#080B12;border:2px solid var(--primary);border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--primary)">
            ${icon('scissors')}
          </div>
          <h3 style="color:#FFFFFF;margin:0 0 4px;font-size:18px">${esc(shopName)}</h3>
          <p style="color:var(--text-dim);font-size:12px;margin:0 0 16px">${esc(shopAddress)}</p>
          <div style="background:#FFFFFF;padding:8px;border-radius:10px;display:inline-block;margin-bottom:14px">
            <div style="width:120px;height:120px;display:flex;align-items:center;justify-content:center">
              ${qrSvg.replace('width="180"', 'width="120"').replace('height="180"', 'height="120"')}
            </div>
          </div>
          <div style="font-size:11px;color:var(--primary);font-weight:600;margin-bottom:12px">
            Aponte a câmera e agende online
          </div>
          <div style="font-size:11.5px;color:var(--text-dim)">
            Instagram: <strong style="color:#FFFFFF">${esc(shopInstagram)}</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Texto Pronto para Divulgação</h2>
          <span class="card-sub">Copie e cole em redes sociais</span>
        </div>
        <div class="field">
          <label>Legenda para Post / Stories no Instagram</label>
          <textarea class="control" id="mkt-post-text" rows="5" readonly style="font-size:13px;line-height:1.5">Fala galera! 💈✂️
Para sua comodidade, agora você pode agendar seu horário na ${esc(shopName)} em menos de 1 minuto diretamente pelo celular, sem precisar baixar nada!

👉 Basta acessar o link da nossa bio:
${esc(publicUrl)}

Escolha seu barbeiro, o melhor horário e receba a confirmação na hora! Te esperamos na cadeira. 🔥</textarea>
          <button class="btn btn-sm" id="btn-copy-post" type="button" style="margin-top:8px">
            ${icon('clipboard')} Copiar Texto para Instagram
          </button>
        </div>

        <div style="margin-top:24px;padding:16px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);border-radius:12px">
          <strong style="color:var(--primary-hover);display:block;margin-bottom:4px">💡 Dica Nova Runtime:</strong>
          <p class="muted" style="font-size:12.5px;margin:0">
            Adicione o adesivo "Link" nos stories semanais do Instagram direcionando para <code>${publicUrl}</code>. Nossos testes mostram um aumento de 42% no preenchimento de horários vazios de terça a quinta-feira!
          </p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-copy-url')?.addEventListener('click', () => {
    navigator.clipboard.writeText(publicUrl).then(() => toast('Link público copiado!', 'ok')).catch(() => toast('Não foi possível copiar automaticamente.', 'error'));
  });

  document.getElementById('btn-copy-tenant')?.addEventListener('click', () => {
    navigator.clipboard.writeText(customShopUrl).then(() => toast('Link personalizado copiado!', 'ok')).catch(() => toast('Não foi possível copiar automaticamente.', 'error'));
  });

  document.getElementById('btn-copy-post')?.addEventListener('click', () => {
    const text = document.getElementById('mkt-post-text').value;
    navigator.clipboard.writeText(text).then(() => toast('Texto para Instagram copiado!', 'ok')).catch(() => toast('Não foi possível copiar automaticamente.', 'error'));
  });

  document.getElementById('btn-share-wa')?.addEventListener('click', () => {
    const text = encodeURIComponent(`Olá! Agende seu horário na ${shopName} pelo link: ${publicUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
  });

  document.getElementById('btn-print-qr')?.addEventListener('click', () => {
    const printWin = window.open('', '_blank');
    if (!printWin) {
      toast('Permita pop-ups neste site para imprimir o display de balcão.', 'warn');
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Display de Balcão - ${esc(shopName)}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; text-align: center; margin: 0; padding: 40px; color: #080B12; background: #FFFFFF; }
          .container { max-width: 480px; margin: 0 auto; border: 3px solid #080B12; border-radius: 24px; padding: 48px 32px; box-sizing: border-box; }
          h1 { font-size: 28px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px; }
          p { font-size: 16px; color: #475569; margin: 0 0 24px; }
          .qr-box { margin: 24px 0; }
          .cta { font-size: 20px; font-weight: 700; color: #2563EB; margin: 18px 0 6px; }
          .sub { font-size: 13px; color: #64748B; }
          .footer { margin-top: 32px; font-size: 14px; border-top: 1px solid #E2E8F0; padding-top: 16px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${esc(shopName)}</h1>
          <p>Agendamento Rápido &bull; Sem Filas</p>
          <div class="cta">Aponte a câmera do seu celular</div>
          <div class="sub">Escolha seu serviço, barbeiro e horário em 1 minuto</div>
          <div class="qr-box">${qrSvg}</div>
          <div class="footer">${esc(shopAddress)} &bull; ${esc(shopInstagram)}</div>
        </div>
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  });
}

/* -------------------------------- Financeiro ------------------------------ */

let financeRange = { from: addDays(todayISO(), -29), to: todayISO() };

async function viewFinance() {
  const qs = `?from=${encodeURIComponent(financeRange.from)}&to=${encodeURIComponent(financeRange.to)}`;
  const data = await api.get(`/api/finance/summary${qs}`);
  const summary = data.summary || {};
  const byMethod = data.by_payment_method || [];
  const closing = data.cash_closing || [];
  const expenses = data.expenses || [];
  const methodLabel = {
    pix: 'PIX',
    credit_card: 'Cartão de Crédito',
    debit_card: 'Cartão de Débito',
    cash: 'Dinheiro',
    other: 'Outro',
  };

  content().innerHTML = `
    <div class="stack" style="gap:18px">
      <div class="card">
        <div class="card-body row-actions" style="justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div class="row-actions" style="gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm" data-fin-preset="today">Hoje</button>
            <button type="button" class="btn btn-sm" data-fin-preset="7d">7 dias</button>
            <button type="button" class="btn btn-sm" data-fin-preset="30d">30 dias</button>
            <button type="button" class="btn btn-sm" data-fin-preset="month">Mês atual</button>
          </div>
          <form id="fin-range-form" class="row-actions" style="gap:8px;flex-wrap:wrap">
            <input type="date" id="fin-from" value="${esc(financeRange.from)}" />
            <span class="muted">até</span>
            <input type="date" id="fin-to" value="${esc(financeRange.to)}" />
            <button type="submit" class="btn btn-primary btn-sm">Filtrar</button>
          </form>
        </div>
      </div>

      <div class="ct-kpi-grid">
        <div class="ct-kpi-card">
          <div class="ct-kpi-top">
            <span class="ct-kpi-label">Receita Bruta Realizada</span>
            <span class="ct-badge ok">${Number(summary.completed_count || 0)} atend.</span>
          </div>
          <div class="ct-kpi-value">${esc(money(summary.revenue_realized || 0))}</div>
          <div class="ct-kpi-foot"><span>Previsto: ${esc(money(summary.revenue_expected || 0))}</span></div>
        </div>

        <div class="ct-kpi-card">
          <div class="ct-kpi-top">
            <span class="ct-kpi-label">Comissões da Equipe</span>
            <span class="ct-badge">${esc(money(summary.total_commissions || 0))}</span>
          </div>
          <div class="ct-kpi-value">${esc(money(summary.total_commissions || 0))}</div>
          <div class="ct-kpi-foot"><span>Calculado por profissional</span></div>
        </div>

        <div class="ct-kpi-card">
          <div class="ct-kpi-top">
            <span class="ct-kpi-label">Despesas Operacionais</span>
            <span class="ct-badge">${expenses.length} lanç.</span>
          </div>
          <div class="ct-kpi-value">${esc(money(summary.total_expenses || 0))}</div>
          <div class="ct-kpi-foot"><span>Custos fixos e variáveis</span></div>
        </div>

        <div class="ct-kpi-card ct-kpi-highlight">
          <div class="ct-kpi-top">
            <span class="ct-kpi-label">Lucro Líquido Real</span>
            <span class="ct-badge">${Number(summary.revenue_realized || 0) > 0 ? Math.round((Number(summary.net_profit || 0) / Number(summary.revenue_realized)) * 100) : 0}% margem</span>
          </div>
          <div class="ct-kpi-value">${esc(money(summary.net_profit || 0))}</div>
          <div class="ct-kpi-foot"><span>Receita − Comissões − Despesas</span></div>
        </div>
      </div>

      <div class="grid-2" style="gap:16px">
        <div class="card">
          <div class="card-header"><strong>Formas de Pagamento</strong><span class="muted">Atendimentos concluídos</span></div>
          <div class="card-body">
            ${
              byMethod.length
                ? `<div class="table-wrap"><table><thead><tr><th>Forma</th><th>Qtd</th><th>Total</th></tr></thead><tbody>
                    ${byMethod
                      .map(
                        (row) => `<tr>
                          <td>${esc(methodLabel[row.payment_method] || row.payment_method)}</td>
                          <td>${Number(row.count)}</td>
                          <td><strong>${esc(money(row.total))}</strong></td>
                        </tr>`
                      )
                      .join('')}
                  </tbody></table></div>`
                : '<p class="muted">Nenhum atendimento concluído no período.</p>'
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header"><strong>Lançar Despesa</strong><span class="muted">Registro operacional</span></div>
          <div class="card-body">
            <form id="fin-expense-form" class="form-grid">
              <div class="field span-2">
                <label for="exp-desc">Descrição</label>
                <input id="exp-desc" name="description" required maxlength="140" placeholder="Ex.: Aluguel, Energia, Pomadas..." />
              </div>
              <div class="field">
                <label for="exp-cat">Categoria</label>
                <select id="exp-cat" name="category">
                  <option value="Operacional">Operacional</option>
                  <option value="Produtos">Produtos</option>
                  <option value="Aluguel">Aluguel</option>
                  <option value="Energia/Água">Energia/Água</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
              <div class="field">
                <label for="exp-amount">Valor (R$)</label>
                <input id="exp-amount" name="amount" type="number" step="0.01" min="0.01" required placeholder="0,00" />
              </div>
              <div class="field">
                <label for="exp-date">Data</label>
                <input id="exp-date" name="date" type="date" value="${esc(todayISO())}" required />
              </div>
              <div class="field">
                <label for="exp-method">Pagamento</label>
                <select id="exp-method" name="payment_method">
                  <option value="pix">PIX</option>
                  <option value="cash">Dinheiro</option>
                  <option value="debit_card">Cartão Débito</option>
                  <option value="credit_card">Cartão Crédito</option>
                  <option value="other">Outro</option>
                </select>
              </div>
              <div class="field span-2">
                <button type="submit" class="btn btn-primary">Registrar Despesa</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><strong>Fechamento de Caixa Diário</strong><span class="muted">Receita, despesas e saldo</span></div>
        <div class="card-body">
          ${
            closing.length
              ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Receita</th><th>Despesas</th><th>Saldo</th></tr></thead><tbody>
                  ${closing
                    .map(
                      (row) => `<tr>
                        <td>${esc(formatDateBR(row.date))}</td>
                        <td>${esc(money(row.revenue))}</td>
                        <td>${esc(money(row.expenses))}</td>
                        <td><strong>${esc(money(row.net))}</strong></td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
              : '<p class="muted">Sem movimentação financeira no período.</p>'
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><strong>Histórico de Despesas</strong><span class="muted">${expenses.length} lançamento(s)</span></div>
        <div class="card-body">
          ${
            expenses.length
              ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th>Valor</th><th></th></tr></thead><tbody>
                  ${expenses
                    .map(
                      (exp) => `<tr>
                        <td>${esc(formatDateBR(exp.date))}</td>
                        <td>${esc(exp.description)}</td>
                        <td><span class="tag">${esc(exp.category)}</span></td>
                        <td>${esc(methodLabel[exp.payment_method] || exp.payment_method)}</td>
                        <td><strong>${esc(money(exp.amount))}</strong></td>
                        <td><button type="button" class="btn btn-danger btn-sm" data-del-expense="${exp.id}">Excluir</button></td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
              : '<p class="muted">Nenhuma despesa registrada neste período.</p>'
          }
        </div>
      </div>
    </div>`;

  document.querySelectorAll('[data-fin-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const today = todayISO();
      const preset = btn.dataset.finPreset;
      if (preset === 'today') financeRange = { from: today, to: today };
      else if (preset === '7d') financeRange = { from: addDays(today, -6), to: today };
      else if (preset === '30d') financeRange = { from: addDays(today, -29), to: today };
      else if (preset === 'month') financeRange = { from: `${today.slice(0, 7)}-01`, to: today };
      viewFinance();
    });
  });

  document.getElementById('fin-range-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    financeRange = {
      from: document.getElementById('fin-from').value,
      to: document.getElementById('fin-to').value,
    };
    viewFinance();
  });

  document.getElementById('fin-expense-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const payload = {
      description: form.description.value.trim(),
      category: form.category.value,
      amount: Number(form.amount.value),
      date: form.date.value,
      payment_method: form.payment_method.value,
    };
    try {
      await api.post('/api/finance/expenses', payload);
      toast('Despesa registrada com sucesso.');
      viewFinance();
    } catch (err) {
      toast(err.message || 'Erro ao registrar despesa.', 'error');
    }
  });

  document.querySelectorAll('[data-del-expense]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delExpense;
      if (!(await confirmDialog('Excluir esta despesa?', 'Esta ação remove o lançamento do fechamento de caixa.'))) return;
      try {
        await api.del(`/api/finance/expenses/${id}`);
        toast('Despesa removida.');
        viewFinance();
      } catch (err) {
        toast(err.message || 'Erro ao excluir despesa.', 'error');
      }
    });
  });
}

/* ------------------------------ Painel Master ----------------------------- */

async function viewMaster() {
  const [overview, shopsList, logsData] = await Promise.all([
    api.get('/api/master/overview'),
    api.get('/api/master/shops'),
    api.get('/api/master/logs'),
  ]);
  const shopTotals = overview.shops || {};
  const apptTotals = overview.appointments || {};
  const shops = Array.isArray(shopsList) ? shopsList : [];
  const recentShops = logsData.recent_shops || [];
  const recentMessages = logsData.recent_messages || [];

  content().innerHTML = `
    <div class="stack" style="gap:18px">
      <div class="ct-kpi-grid">
        <div class="ct-kpi-card">
          <div class="ct-kpi-top"><span class="ct-kpi-label">Barbearias Cadastradas</span><span class="ct-badge ok">${Number(shopTotals.active || 0)} ativas</span></div>
          <div class="ct-kpi-value">${Number(shopTotals.total || 0)}</div>
          <div class="ct-kpi-foot"><span>${Number(shopTotals.suspended || 0)} suspensa(s)</span></div>
        </div>
        <div class="ct-kpi-card ct-kpi-highlight">
          <div class="ct-kpi-top"><span class="ct-kpi-label">GMV da Plataforma</span><span class="ct-badge">Concluídos</span></div>
          <div class="ct-kpi-value">${esc(money(apptTotals.gmv || 0))}</div>
          <div class="ct-kpi-foot"><span>Volume transacionado nas barbearias</span></div>
        </div>
        <div class="ct-kpi-card">
          <div class="ct-kpi-top"><span class="ct-kpi-label">Agendamentos Totais</span><span class="ct-badge">Plataforma</span></div>
          <div class="ct-kpi-value">${Number(apptTotals.total || 0)}</div>
          <div class="ct-kpi-foot"><span>Todos os estabelecimentos</span></div>
        </div>
        <div class="ct-kpi-card">
          <div class="ct-kpi-top"><span class="ct-kpi-label">Saúde do Banco</span><span class="ct-badge ${overview.database?.ok ? 'ok' : ''}">${overview.database?.ok ? 'Online' : 'Alerta'}</span></div>
          <div class="ct-kpi-value">${esc(overview.driver || 'sqlite')}</div>
          <div class="ct-kpi-foot"><span>Latência: ${Number(overview.database?.latency_ms || 0)} ms</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><strong>Estabelecimentos & Assinaturas</strong><span class="muted">${shops.length} barbearia(s)</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Barbearia</th><th>Plano</th><th>Status</th><th>Agend.</th><th>Ações</th></tr></thead>
              <tbody>
                ${shops
                  .map(
                    (s) => `<tr>
                      <td>#${Number(s.id)}</td>
                      <td><strong>${esc(s.name)}</strong><br><span class="muted">/b/${esc(s.slug)}</span></td>
                      <td>
                        <select class="master-plan-select" data-shop-id="${s.id}" style="min-width:130px">
                          <option value="free" ${s.plan_id === 'free' ? 'selected' : ''}>Gratuito / Demo</option>
                          <option value="basic" ${s.plan_id === 'basic' ? 'selected' : ''}>Básico</option>
                          <option value="pro" ${s.plan_id === 'pro' ? 'selected' : ''}>Profissional</option>
                        </select>
                      </td>
                      <td>${s.active ? '<span class="tag ok">Ativa</span>' : '<span class="tag danger">Suspensa</span>'}</td>
                      <td>${Number(s.appointments_count || 0)}</td>
                      <td>
                        <button type="button" class="btn btn-sm ${s.active ? 'btn-danger' : 'btn-ok'}" data-toggle-shop="${s.id}" data-next-active="${s.active ? 0 : 1}">
                          ${s.active ? 'Suspender' : 'Reativar'}
                        </button>
                      </td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid-2" style="gap:16px">
        <div class="card">
          <div class="card-header"><strong>Últimas Barbearias Cadastradas</strong><span class="muted">Onboarding</span></div>
          <div class="card-body">
            ${
              recentShops.length
                ? `<div class="table-wrap"><table><thead><tr><th>Barbearia</th><th>Slug</th><th>Status</th></tr></thead><tbody>
                    ${recentShops
                      .map(
                        (rs) => `<tr>
                          <td><strong>${esc(rs.name)}</strong></td>
                          <td class="muted">/b/${esc(rs.slug)}</td>
                          <td>${Number(rs.active) === 1 ? '<span class="tag ok">Ativa</span>' : '<span class="tag danger">Suspensa</span>'}</td>
                        </tr>`
                      )
                      .join('')}
                  </tbody></table></div>`
                : '<p class="muted">Sem cadastros recentes.</p>'
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header"><strong>Fila Recente de Mensagens WhatsApp</strong><span class="muted">Telemetria</span></div>
          <div class="card-body">
            ${
              recentMessages.length
                ? `<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Status</th><th>Data</th></tr></thead><tbody>
                    ${recentMessages
                      .map(
                        (m) => `<tr>
                          <td><span class="tag">${esc(m.type || '')}</span></td>
                          <td>${esc(m.status || '')}</td>
                          <td class="muted">${esc(m.created_at || '')}</td>
                        </tr>`
                      )
                      .join('')}
                  </tbody></table></div>`
                : '<p class="muted">Nenhuma mensagem enfileirada.</p>'
            }
          </div>
        </div>
      </div>
    </div>`;

  document.querySelectorAll('.master-plan-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api.patch(`/api/master/shops/${sel.dataset.shopId}`, { plan_id: sel.value });
        toast('Plano atualizado com sucesso.');
        viewMaster();
      } catch (err) {
        toast(err.message || 'Erro ao atualizar plano.', 'error');
      }
    });
  });

  document.querySelectorAll('[data-toggle-shop]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextActive = Number(btn.dataset.nextActive) === 1;
      try {
        await api.patch(`/api/master/shops/${btn.dataset.toggleShop}`, { active: nextActive });
        toast(nextActive ? 'Barbearia reativada.' : 'Barbearia suspensa.');
        viewMaster();
      } catch (err) {
        toast(err.message || 'Erro ao alterar status da barbearia.', 'error');
      }
    });
  });
}

/* --------------------------------- Roteador ------------------------------- */

const VIEWS = {
  dashboard: viewDashboard,
  agenda: viewAgenda,
  appointments: viewAppointments,
  clients: viewClients,
  finance: viewFinance,
  reports: viewReports,
  marketing: viewMarketing,
  barbers: viewBarbers,
  services: viewServices,
  settings: viewSettings,
  backup: viewBackup,
  master: viewMaster,
};

function currentViewFromHash() {
  const params = new URLSearchParams(window.location.search);
  const key = (location.hash || '').replace(/^#\/?/, '') || params.get('view');
  const match = NAV.find((item) => item.key === key);
  if (!match) return 'dashboard';
  if (match.masterOnly && !state.me?.is_master) return 'dashboard';
  return match.key;
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
  animateShellBoot();
  await navigate(currentViewFromHash());
}

function boot() {
  initGsapMotion();
  const root = document.getElementById('app');
  root.innerHTML = `<div class="boot-screen"><div class="spinner"></div><span>Carregando o Gestor de Barbearia...</span></div>`;
  api
    .get('/api/auth/me')
    .then((me) => {
      state.me = me;
      if (!me.authenticated || currentViewFromHash() === 'login') {
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
