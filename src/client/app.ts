/**
 * Painel administrativo SPA em TypeScript Estrito — Gestor de Barbearia (NOVA RUNTIME)
 * Views: Dashboard, Agenda (dia/semana), Agendamentos, Clientes, Financeiro,
 * Relatórios, Divulgação & QR, Profissionais, Serviços, Configurações e Backup.
 */

import {
  animateAuthScreen,
  animateChartsAndBars,
  animateFolgaToggle,
  animateNavItemActive,
  animateNumbers,
  animatePanelView,
  animateShellBoot,
  animateSidebarMobileOpen,
  initGsapMotion,
} from '../animations/index.js';
import { ApiError, api, errorMessage, errorStatus, query } from './api.js';
import { openAppointmentDetails, openAppointmentForm } from './appointments-ui.js';
import type {
  Appointment,
  AuthMeResponse,
  BackupMeta,
  BackupResponse,
  Barber,
  BillingPlanResponse,
  BusinessHours,
  Closure,
  DashboardRecentActivity,
  DashboardResponse,
  FinanceSummaryResponse,
  HealthResponse,
  ReportDailyRow,
  ReportResponse,
  Service,
  Settings,
  ThemeMode,
  WhatsAppConfig,
} from './types.js';
import {
  addDays,
  button,
  confirmDialog,
  emptyBlock,
  esc,
  formatDateBR,
  formatDateLong,
  formatPhone,
  hydrateLottieElements,
  icon,
  initials,
  money,
  novaRuntimeSignature,
  openModal,
  readForm,
  setBusy,
  skeletonCards,
  skeletonDashboard,
  skeletonTable,
  statusPill,
  toast,
  todayISO,
  WEEKDAYS_SHORT,
} from './ui.js';

import {
  content,
  loadCatalog,
  navigate,
  refresh,
  registerPanelHooks,
  state,
  submitShopClosure,
  type ViewKey,
  weekDates,
} from './panel-context.js';
import { viewAgenda, viewAppointments } from './views/agenda.js';
import { viewClients } from './views/clients.js';
import { viewFinance } from './views/finance.js';
import { viewMarketing } from './views/marketing.js';
import { viewReports } from './views/reports.js';
import { viewSettings } from './views/settings.js';

/* --------------------------------- Estado -------------------------------- */

type DashRangeKey = 'today' | '7d' | '30d' | 'month';
type DashStatusFilter = 'all' | 'confirmed' | 'completed' | 'pending' | 'cancelled';

interface NavItemDef {
  key: ViewKey;
  label: string;
  icon: string;
  group: string;
}

const NAV: readonly NavItemDef[] = [
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
];



/* ---------------------------------- Tema ---------------------------------- */

function getStoredTheme(): ThemeMode {
  try {
    return localStorage.getItem('gb_theme_v2') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function themeIconSvg(theme: ThemeMode): string {
  if (theme === 'light') {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
}

function applyTheme(theme: ThemeMode): void {
  const next: ThemeMode = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('gb_theme_v2', next);
    localStorage.removeItem('gb_theme');
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

function toggleTheme(): void {
  applyTheme(getStoredTheme() === 'light' ? 'dark' : 'light');
}

applyTheme(getStoredTheme());

/* -------------------------------- Auxiliares ------------------------------ */

function onboardingNotice(): string {
  const missing: string[] = [];
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

function topNotices(): string {
  const parts: string[] = [];
  if (state.me?.demo) {
    parts.push('Modo demonstração (dados fictícios)');
  }
  if (state.me?.password_is_default) {
    parts.push(
      'Troque a senha inicial em <a href="#/settings" style="color:var(--accent-2);text-decoration:underline">Configurações</a>'
    );
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

function readOAuthErrorFromHash(): string {
  const hash = location.hash || '';
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return '';
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return params.get('oauth_error') || '';
}

function renderLogin(): void {
  stopDashboardPolling();
  const root = document.getElementById('app');
  if (!root) return;
  const oauthError = readOAuthErrorFromHash();
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
        <div class="field hidden" id="login-totp-wrap" style="margin-top:10px">
          <label for="login-totp">Código 2FA (6 dígitos)</label>
          <input type="text" id="login-totp" name="totp_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary btn-block" type="submit">Entrar no Sistema</button>
        </div>
        <div class="auth-hint">
          Acesso restrito a contas autorizadas.
        </div>
        ${novaRuntimeSignature()}
      </form>
    </div>`;

  const form = document.getElementById('login-form') as HTMLFormElement | null;
  const emailInput = document.getElementById('login-email') as HTMLInputElement | null;
  const passwordInput = document.getElementById('login-password') as HTMLInputElement | null;
  const totpWrap = document.getElementById('login-totp-wrap');
  const totpInput = document.getElementById('login-totp') as HTMLInputElement | null;
  animateAuthScreen(root);
  passwordInput?.focus();

  form?.addEventListener('submit', (event: SubmitEvent) => {
    event.preventDefault();
    void (async () => {
      const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]');
      setBusy(submitBtn, true, 'Entrando...');
      try {
        const payload: Record<string, string> = { password: passwordInput?.value ?? '' };
        const email = emailInput?.value.trim() ?? '';
        const totpCode = totpInput?.value.trim() ?? '';
        if (email) payload['email'] = email;
        if (totpCode) payload['totp_code'] = totpCode;
        await api.post('/api/auth/login', payload);
        state.me = await api.get<AuthMeResponse>('/api/auth/me');
        await startApp();
      } catch (error: unknown) {
        if (error instanceof ApiError && error.payload?.['requires_2fa']) {
          totpWrap?.classList.remove('hidden');
          setBusy(submitBtn, false);
          toast('Informe o código de 6 dígitos do seu autenticador 2FA.', 'warn');
          totpInput?.focus();
          return;
        }
        toast(errorMessage(error), 'error');
        setBusy(submitBtn, false);
        passwordInput?.select();
      }
    })();
  });
}

/* --------------------------------- Shell --------------------------------- */

function navItem(item: NavItemDef): string {
  return `<a class="nav-item" data-view="${item.key}" href="#/${item.key}">${icon(item.icon)}<span>${esc(item.label)}</span></a>`;
}

function shellHtml(): string {
  const groups = ['Gestão', 'Cadastros', 'Marketing', 'Sistema'];
  const navHtml = groups
    .map((group) => {
      const items = NAV.filter((item) => item.group === group);
      if (!items.length) return '';
      return `<div class="nav-label">${esc(group)}</div>${items.map(navItem).join('')}`;
    })
    .join('');

  const theme = getStoredTheme();
  const userEmail = state.me?.user?.email;
  const userRole = state.me?.user?.role;
  const userShopId = state.me?.user?.shop_id ?? 1;

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
          <a class="nav-item" href="/agendar" target="_blank" rel="noopener">${icon('external')}<span>Página de agendamento</span></a>
          <button class="nav-item" type="button" id="logout">${icon('logout')}<span>Sair do painel</span></button>
          ${novaRuntimeSignature()}
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
            <button class="icon-btn" id="theme-toggle" type="button" title="${theme === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro'}" aria-label="Alternar tema">${themeIconSvg(theme)}</button>
            ${
              userEmail
                ? `<div class="user-menu-wrap">
                    <button class="user-pill user-pill-btn" id="user-menu-btn" type="button" aria-expanded="false" title="${esc(userEmail)}">
                      <span class="user-pill-avatar">${esc(userEmail.slice(0, 1).toUpperCase())}</span>
                      <span class="user-pill-label hide-mobile">${esc(userEmail)}</span>
                    </button>
                    <div class="user-menu-dropdown" id="user-menu-dropdown">
                      <div class="user-menu-head">
                        <strong>${esc(userEmail)}</strong>
                        <span>${esc(userRole === 'owner' ? 'Proprietário / Admin' : userRole || 'Admin')} · Loja #${esc(String(userShopId))}</span>
                      </div>
                      <button class="user-menu-item" type="button" id="menu-theme-toggle">${themeIconSvg(theme)}<span id="menu-theme-label">${theme === 'light' ? 'Tema escuro' : 'Tema claro'}</span></button>
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

function wireShell(): void {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const closeSidebar = (): void => {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('open');
  };

  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    if (!sidebar || !backdrop) return;
    const isOpen = sidebar.classList.toggle('open');
    backdrop.classList.toggle('open');
    if (isOpen) animateSidebarMobileOpen();
  });
  backdrop?.addEventListener('click', closeSidebar);
  document.querySelectorAll<HTMLElement>('.nav-item[data-view]').forEach((element) => {
    element.addEventListener('click', closeSidebar);
  });

  document.getElementById('quick-new')?.addEventListener('click', () => {
    void openAppointmentForm({
      defaults: { date: state.date },
      onSaved: () => {
        void refresh();
      },
    });
  });

  const doLogout = async (): Promise<void> => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignora */
    }
    location.hash = '';
    renderLogin();
  };

  document.getElementById('logout')?.addEventListener('click', () => void doLogout());
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('menu-theme-toggle')?.addEventListener('click', toggleTheme);

  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuDrop = document.getElementById('user-menu-dropdown');
  if (userMenuBtn && userMenuDrop) {
    userMenuBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      const open = userMenuDrop.classList.toggle('open');
      userMenuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => {
      userMenuDrop.classList.remove('open');
      userMenuBtn.setAttribute('aria-expanded', 'false');
    });
    document.getElementById('topbar-logout')?.addEventListener('click', () => void doLogout());
  }

  if (state.me?.password_is_default && !state.me?.demo) {
    renderForcePasswordScreen();
    return;
  }

  const contentEl = document.getElementById('content');
  if (contentEl && typeof MutationObserver !== 'undefined') {
    let rafId = 0;
    const observer = new MutationObserver(() => {
      if (contentEl.querySelector('[data-skeleton="1"], [data-loading="1"]')) {
        hydrateLottieElements(contentEl);
        return;
      }
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => animatePanelView(contentEl));
    });
    observer.observe(contentEl, { childList: true });
  }
}

function renderForcePasswordScreen(): void {
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
        ${novaRuntimeSignature()}
      </div>
    </div>`;

  document.getElementById('force-pw-form')?.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    void (async () => {
      const current_password = (document.getElementById('fp-current') as HTMLInputElement | null)?.value ?? '';
      const new_password = (document.getElementById('fp-new') as HTMLInputElement | null)?.value ?? '';
      const confirmPw = (document.getElementById('fp-confirm') as HTMLInputElement | null)?.value ?? '';
      if (new_password !== confirmPw) {
        toast('As senhas novas não coincidem.', 'error');
        return;
      }
      try {
        await api.post('/api/settings/password', { current_password, new_password });
        if (state.me) state.me.password_is_default = false;
        toast('Senha atualizada com sucesso!', 'success');
        boot();
      } catch (error: unknown) {
        toast(errorMessage(error, 'Erro ao atualizar senha.'), 'error');
      }
    })();
  });
}

/* ------------------------------- Navegação -------------------------------- */

const TITLES: Record<ViewKey, string> = {
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
};

function subtitleFor(view: ViewKey): string {
  switch (view) {
    case 'dashboard':
      return formatDateLong(state.date);
    case 'agenda': {
      const dates = weekDates(state.date);
      return state.mode === 'week'
        ? `Semana de ${formatDateBR(dates[0])} a ${formatDateBR(dates[6])}`
        : formatDateLong(state.date);
    }
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
  }
}

let dashPollTimer: number | null = null;
let dashVisibilityHandler: (() => void) | null = null;
let dashRequestSeq = 0;
interface DashPrevMetrics {
  expected?: number;
  realized?: number;
  profit?: number;
  appointments?: number;
}
let dashPrevMetrics: DashPrevMetrics | null = null;

function stopDashboardPolling(): void {
  if (dashPollTimer !== null) {
    window.clearInterval(dashPollTimer);
    dashPollTimer = null;
  }
  if (dashVisibilityHandler) {
    document.removeEventListener('visibilitychange', dashVisibilityHandler);
    dashVisibilityHandler = null;
  }
}

async function navigateToView(view: ViewKey): Promise<void> {
  stopDashboardPolling();
  dashPrevMetrics = null;
  const meta = NAV.find((item) => item.key === view) ?? NAV[0]!;
  state.view = meta.key;

  document.querySelectorAll<HTMLElement>('.nav-item[data-view]').forEach((element) => {
    const isActive = element.dataset.view === meta.key;
    element.classList.toggle('active', isActive);
    if (isActive) animateNavItemActive(element);
  });
  const title = document.getElementById('page-title');
  const sub = document.getElementById('page-sub');
  if (title) title.textContent = TITLES[meta.key];
  if (sub) sub.textContent = subtitleFor(meta.key);

  if (meta.key === 'dashboard') {
    content().innerHTML = skeletonDashboard();
  } else if (meta.key === 'barbers') {
    content().innerHTML = skeletonCards(3);
  } else {
    content().innerHTML = skeletonTable(6);
  }

  try {
    await VIEWS[meta.key]();
  } catch (error: unknown) {
    const status = errorStatus(error);
    const msg = errorMessage(error);
    if (status === 401) {
      renderLogin();
      return;
    }
    if (status === 403 && msg.toLowerCase().includes('senha')) {
      renderForcePasswordScreen();
      return;
    }
    content().innerHTML = emptyBlock('Não foi possível carregar esta tela', msg);
  }
}

/* -------------------------------- Dashboard ------------------------------- */

function resolveDashboardRange(
  rangeKey: DashRangeKey,
  refDate: string
): { from: string; to: string; label: string } {
  const to = refDate || todayISO();
  if (rangeKey === 'today') return { from: to, to, label: 'Hoje' };
  if (rangeKey === '7d') return { from: addDays(to, -6), to, label: 'Últimos 7 dias' };
  if (rangeKey === 'month') return { from: `${to.slice(0, 7)}-01`, to, label: 'Mês Atual' };
  return { from: addDays(to, -29), to, label: 'Últimos 30 dias' };
}

function buildSparklineSvg(dailyRows?: ReportDailyRow[]): string {
  const source =
    dailyRows && dailyRows.length
      ? dailyRows.slice(-10)
      : [
          { revenue: 0, revenue_expected: 0 },
          { revenue: 0, revenue_expected: 0 },
        ];
  const values = source.map((d) => Number(d.revenue || d.revenue_expected || 0));
  if (values.length === 1) values.unshift(values[0] ?? 0);
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

/** Gráfico SVG limpo de barras + linhas comparando receita realizada vs prevista no período. */
function buildFinancialChartSvg(
  dailyRows: ReportDailyRow[] | undefined,
  fallbackDate: string,
  fallbackRealized: number,
  fallbackExpected: number
): string {
  const rows: Array<{ date: string; realized: number; expected: number }> =
    dailyRows && dailyRows.length
      ? dailyRows.slice(-14).map((d) => ({
          date: d.date,
          realized: Number(d.revenue_realized ?? d.revenue ?? 0),
          expected: Number(d.revenue_expected ?? d.revenue ?? 0),
        }))
      : [{ date: fallbackDate, realized: fallbackRealized, expected: fallbackExpected }];

  const chartPoints = rows.length === 1 ? [rows[0]!, rows[0]!] : rows;
  const rawMaxVal = Math.max(
    0,
    ...chartPoints.map((p) => Math.max(p.realized, p.expected))
  );
  const maxVal = Math.max(1, rawMaxVal);

  const vbW = 560;
  const vbH = 168;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 24;
  const plotW = vbW - padL - padR;
  const plotH = vbH - padT - padB;
  const baseY = padT + plotH;

  const xAt = (idx: number): number =>
    chartPoints.length <= 1
      ? padL + plotW / 2
      : Number((padL + (idx / (chartPoints.length - 1)) * plotW).toFixed(1));
  const yAt = (val: number): number =>
    Number((baseY - (Math.max(0, val) / maxVal) * plotH).toFixed(1));

  const expCoords = chartPoints.map((p, i) => [xAt(i), yAt(p.expected)] as const);
  const realCoords = chartPoints.map((p, i) => [xAt(i), yAt(p.realized)] as const);

  const expLine = expCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0]},${c[1]}`).join(' ');
  const realLine = realCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0]},${c[1]}`).join(' ');

  const firstX = expCoords[0]?.[0] ?? padL;
  const lastX = expCoords[expCoords.length - 1]?.[0] ?? vbW - padR;
  const expArea = `${expLine} L${lastX},${baseY} L${firstX},${baseY} Z`;
  const realArea = `${realLine} L${lastX},${baseY} L${firstX},${baseY} Z`;

  const barWidth = Math.max(6, Math.min(22, Math.floor((plotW / Math.max(1, rows.length)) * 0.42)));
  const barsSvg = rows
    .map((r, i) => {
      const cx = rows.length === 1 ? vbW / 2 : xAt(i);
      const yExp = yAt(r.expected);
      const hExp = Math.max(2, baseY - yExp);
      const yReal = yAt(r.realized);
      const hReal = Math.max(0, baseY - yReal);
      const label = `${formatDateBR(r.date)} — Realizada: ${money(r.realized)} | Prevista: ${money(r.expected)}`;
      return `
        <g>
          <title>${esc(label)}</title>
          <rect x="${(cx - barWidth / 2).toFixed(1)}" y="${yExp}" width="${barWidth}" height="${hExp.toFixed(1)}" rx="3" fill="rgba(96, 165, 250, 0.14)" />
          ${
            hReal > 0
              ? `<rect x="${(cx - barWidth / 2).toFixed(1)}" y="${yReal}" width="${barWidth}" height="${hReal.toFixed(1)}" rx="3" fill="rgba(16, 185, 129, 0.34)" />`
              : ''
          }
        </g>`;
    })
    .join('');

  const labelStep = Math.max(1, Math.ceil(rows.length / 6));
  const xLabelsSvg = rows
    .map((r, i) => {
      if (i % labelStep !== 0 && i !== rows.length - 1) return '';
      const cx = rows.length === 1 ? vbW / 2 : xAt(i);
      const shortDate = formatDateBR(r.date).slice(0, 5);
      return `<text x="${cx}" y="${vbH - 6}" text-anchor="middle" fill="var(--text-faint)" font-size="10.5" font-family="var(--font-mono, monospace)">${esc(shortDate)}</text>`;
    })
    .join('');

  const gridSvg = [0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const gy = (baseY - ratio * plotH).toFixed(1);
      return `<line x1="${padL}" y1="${gy}" x2="${vbW - padR}" y2="${gy}" stroke="rgba(148, 163, 184, 0.12)" stroke-dasharray="3 3" />`;
    })
    .join('');

  return `
    <div class="fin-chart-wrap">
      <svg class="fin-chart-svg" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="none" role="img" aria-label="Gráfico comparativo de receita realizada e receita prevista">
        ${gridSvg}
        <path class="fin-chart-area" d="${expArea}" fill="rgba(59, 130, 246, 0.08)" />
        <path class="fin-chart-area" d="${realArea}" fill="rgba(16, 185, 129, 0.14)" />
        ${barsSvg}
        <path class="fin-chart-line" d="${expLine}" fill="none" stroke="#60A5FA" stroke-width="1.8" stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round" />
        <path class="fin-chart-line" d="${realLine}" fill="none" stroke="#10B981" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
        ${xLabelsSvg}
      </svg>
      <div class="fin-chart-legend">
        <span><i class="fin-legend-dot" style="background:#10B981"></i>Receita realizada</span>
        <span><i class="fin-legend-dot" style="background:#60A5FA"></i>Receita prevista</span>
        <span class="spacer"></span>
        <span class="mono">Pico: ${esc(money(rawMaxVal))}</span>
      </div>
    </div>`;
}

interface NormalizedBusinessDay {
  weekday: number;
  is_open: boolean;
  open_time: string;
  close_time: string;
  break_start: string | null;
  break_end: string | null;
}

function normalizeBusinessDays(businessHours: BusinessHours[] | unknown): NormalizedBusinessDay[] {
  const list = Array.isArray(businessHours) ? (businessHours as BusinessHours[]) : [];
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const found = list.find((item) => Number(item.weekday) === weekday);
    return {
      weekday,
      is_open: Boolean(Number(found?.is_open ?? 0)),
      open_time: found?.open_time || '09:00',
      close_time: found?.close_time || '19:00',
      break_start: found?.break_start || null,
      break_end: found?.break_end || null,
    };
  });
}

function renderFolgaDayButtons(
  days: NormalizedBusinessDay[],
  { attr = 'data-dash-folga-w' }: { attr?: string } = {}
): string {
  return days
    .map((day) => {
      const isOpen = Boolean(day.is_open);
      const hoursText = isOpen ? `${day.open_time}–${day.close_time}` : 'Fechado (Folga)';
      const wdLabel = WEEKDAYS_SHORT[day.weekday] ?? '';
      return `
        <button type="button" class="folga-day-btn ${isOpen ? '' : 'is-off'}" ${attr}="${day.weekday}" aria-pressed="${isOpen ? 'false' : 'true'}">
          <div class="folga-day-top">
            <span>${esc(wdLabel)}</span>
            <span class="pill ${isOpen ? 'pill-confirmed' : 'pill-cancelled'}" style="font-size:10px;padding:2px 7px">${isOpen ? 'Aberto' : 'Folga'}</span>
          </div>
          <span class="folga-day-hours mono">${esc(hoursText)}</span>
        </button>`;
    })
    .join('');
}

async function viewDashboard(): Promise<void> {
  await loadCatalog();

  const notice = onboardingNotice();
  const initialRange = resolveDashboardRange(state.dashRange, todayISO());
  let latestDayAppointments: Appointment[] = [];

  content().innerHTML = `
    ${notice}
    <div class="ct-header is-sticky" id="ct-dash-header">
      <div class="ct-header-left">
        <h2 class="ct-title">Visão Geral &amp; Lucros</h2>
        <p class="ct-sub" id="ct-range-sub">
          <span class="ct-sync-dot" id="ct-sync-dot" title="Atualização automática ativa"></span>
          <span id="ct-range-text">${esc(state.me?.shop_name || 'Gestor de Barbearia')} · ${esc(initialRange.label)}</span>
        </p>
      </div>
      <div class="ct-controls">
        <div class="ct-segmented" role="tablist" aria-label="Período do painel">
          ${(
            [
              ['today', 'Hoje'],
              ['7d', '7d'],
              ['30d', '30d'],
              ['month', 'Mês atual'],
            ] as const
          )
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
    <div id="ct-dash-body">${skeletonDashboard()}</div>
  `;

  const syncHeaderUI = (rangeLabel: string, syncing: boolean): void => {
    content()
      .querySelectorAll<HTMLElement>('[data-range]')
      .forEach((btn) => btn.classList.toggle('active', btn.dataset.range === state.dashRange));
    const rangeText = document.getElementById('ct-range-text');
    if (rangeText) {
      rangeText.textContent = `${state.me?.shop_name || 'Gestor de Barbearia'} · ${rangeLabel}`;
    }
    const dot = document.getElementById('ct-sync-dot');
    if (dot) dot.classList.toggle('is-syncing', Boolean(syncing));
  };

  const renderDashboardBody = async ({
    silent = false,
    isInitial = false,
  }: { silent?: boolean; isInitial?: boolean } = {}): Promise<void> => {
    const seq = ++dashRequestSeq;
    const todayIso = todayISO();
    const range = resolveDashboardRange(state.dashRange, todayIso);
    syncHeaderUI(range.label, true);

    const bodyHost = document.getElementById('ct-dash-body');
    if (bodyHost && !silent && !isInitial) {
      bodyHost.classList.add('is-loading');
    }

    try {
      const [data, todayRealData, report, finData, billing, waStatus, health, businessHours, closures] =
        await Promise.all([
          api.get<DashboardResponse>(`/api/dashboard${query({ date: state.date })}`),
          state.date === todayIso
            ? Promise.resolve<DashboardResponse | null>(null)
            : api.get<DashboardResponse>(`/api/dashboard${query({ date: todayIso })}`).catch(() => null),
          api.get<ReportResponse>(`/api/reports${query({ from: range.from, to: range.to })}`).catch(() => null),
          api
            .get<FinanceSummaryResponse>(`/api/finance/summary${query({ from: range.from, to: range.to })}`)
            .catch(() => null),
          api.get<BillingPlanResponse>('/api/billing/plan').catch(() => null),
          api.get<WhatsAppConfig>('/api/whatsapp/config').catch(() => null),
          fetch('/health')
            .then((r) => (r.ok ? (r.json() as Promise<HealthResponse>) : null))
            .catch(() => null),
          api.get<BusinessHours[]>('/api/business-hours').catch(() => [] as BusinessHours[]),
          api.get<Closure[]>('/api/closures').catch(() => [] as Closure[]),
        ]);

      if (seq !== dashRequestSeq || state.view !== 'dashboard') return;
      const targetBody = document.getElementById('ct-dash-body');
      if (!targetBody) return;

      const shopDays = normalizeBusinessDays(businessHours);
      const shopClosures = Array.isArray(closures) ? closures : [];
      const todayHasClosure = shopClosures.some((c) => c.date === todayIso);
      const finSummary = finData?.summary;
      const netProfit = Number(finSummary?.net_profit ?? (report?.totals?.revenue_realized || 0));
      const totalCommissions = Number(finSummary?.total_commissions || 0);
      const totalExpenses = Number(finSummary?.total_expenses || 0);
      const finRealized = Number(finSummary?.revenue_realized || 0);
      const profitMargin = finRealized > 0 ? Math.round((netProfit / finRealized) * 100) : 0;

      const { today } = data;
      latestDayAppointments = today.appointments || [];
      const todayExpectedReal = Number((todayRealData?.today ?? today).revenue_expected || 0);
      const rate = report?.occupancy ? report.occupancy.rate : today.occupancy.rate;
      const occupancyPct = rate === null ? 0 : Math.max(0, Math.min(100, Number(rate)));
      const totals = report?.totals ?? {
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
      const realizedRatio =
        totals.revenue_expected > 0
          ? Math.min(100, Math.round((totals.revenue_realized / totals.revenue_expected) * 100))
          : 0;
      const cancelTotal = Number(totals.cancelled || 0) + Number(totals.no_show || 0);
      const cancelRate = totals.appointments > 0 ? Math.round((cancelTotal / totals.appointments) * 100) : 0;
      const totalClientsPeriod = Number(totals.new_clients || 0) + Number(totals.returning_clients || 0);
      const clientsTotal =
        data.clients_total !== undefined ? Number(data.clients_total) : totalClientsPeriod;
      const repeatPct = Math.round(Number(totals.repeat_rate || 0) * 100);

      const prev: DashPrevMetrics = dashPrevMetrics ?? {};
      dashPrevMetrics = {
        expected: Number(totals.revenue_expected || 0),
        realized: Number(totals.revenue_realized || 0),
        profit: netProfit,
        appointments: Number(totals.appointments || 0),
      };

      const funnelSteps = [
        { label: 'Agendados no período', count: totals.appointments, pct: totals.appointments > 0 ? 100 : 0 },
        {
          label: 'Confirmados e concluídos',
          count: Number(totals.confirmed || 0) + Number(totals.completed || 0),
          pct:
            totals.appointments > 0
              ? Math.round(
                  ((Number(totals.confirmed || 0) + Number(totals.completed || 0)) / totals.appointments) * 100
                )
              : 0,
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

      const topServices = (report?.by_service?.length ? report.by_service : data.top_services || []).slice(0, 5);
      const barberPerfList = (report?.by_barber?.length ? report.by_barber : data.top_barbers || []).slice(0, 5);
      const maxBarberRevenue = Math.max(
        1,
        ...barberPerfList.map((b) => Number('realized' in b && b.realized !== undefined ? b.realized : b.revenue || 0))
      );

      const upcomingList = (data.upcoming || []).slice(0, 5);
      const recentActivityList: DashboardRecentActivity[] =
        data.recent_activity && data.recent_activity.length
          ? data.recent_activity.slice(0, 5)
          : Array.from(
              new Map(
                [...latestDayAppointments, ...(data.upcoming || [])].map((item) => [item.id, item])
              ).values()
            )
              .sort((a, b) => {
                const ta = a.updated_at || a.created_at || `${a.date} ${a.start_time}`;
                const tb = b.updated_at || b.created_at || `${b.date} ${b.start_time}`;
                return tb.localeCompare(ta);
              })
              .slice(0, 5);

      const filterAppts = (list: Appointment[]): Appointment[] => {
        const term = state.dashSearch.trim().toLowerCase();
        return list.filter((item) => {
          if (state.dashStatusFilter === 'confirmed' && item.status !== 'confirmed') return false;
          if (state.dashStatusFilter === 'completed' && item.status !== 'completed') return false;
          if (state.dashStatusFilter === 'pending' && item.status !== 'pending') return false;
          if (state.dashStatusFilter === 'cancelled' && !['cancelled', 'no_show'].includes(item.status)) {
            return false;
          }
          if (!term) return true;
          return `${item.client_name} ${item.service_name || ''} ${item.barber_name || ''}`
            .toLowerCase()
            .includes(term);
        });
      };
      const filteredDayAppts = filterAppts(latestDayAppointments);

      const planName = billing?.plan?.name || 'Plano Gratuito';
      const activeBarbers = billing?.usage?.active_barbers ?? today.occupancy.barbers;
      const maxBarbers = billing?.plan?.max_barbers;
      const barberCapLabel = maxBarbers
        ? `${activeBarbers} / ${maxBarbers} profissionais`
        : `${activeBarbers} profissionais`;
      const waConnected = Boolean((waStatus?.is_configured || waStatus?.configured) && waStatus?.enabled);
      const dbEngine = health?.driver === 'turso' ? 'Turso Cloud (libSQL)' : 'SQLite Local';

      targetBody.classList.remove('is-loading');
      targetBody.innerHTML = `
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
          <div class="ct-kpi-val mono" data-prev-num="${prev.expected ?? ''}">${esc(money(totals.revenue_expected))}</div>
          ${buildSparklineSvg(report?.daily)}
        </div>
        <div class="ct-kpi-foot">
          <span>Hoje: <strong class="mono">${esc(money(todayExpectedReal))}</strong></span>
          <span>Realizado: <strong class="mono">${realizedRatio}%</strong></span>
        </div>
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Receita realizada</div>
            <div class="ct-card-sub">Atendimentos concluídos</div>
          </div>
          <span class="ct-pill is-blue">${realizedRatio}% do previsto</span>
        </div>
        <div class="ct-kpi-val mono" data-prev-num="${prev.realized ?? ''}">${esc(money(totals.revenue_realized))}</div>
        <div class="ct-kpi-foot">
          <span>Ticket médio: <strong class="mono">${esc(money(totals.average_ticket))}</strong></span>
          <span>${totals.completed} atend.</span>
        </div>
      </article>

      <article class="ct-card ct-card-accent">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Lucro líquido real</div>
            <div class="ct-card-sub">${esc(range.label)} · após comissões e despesas</div>
          </div>
          <span class="ct-pill ${netProfit < 0 ? 'is-warn' : 'is-blue'}">${netProfit < 0 ? 'Prejuízo' : `${profitMargin}% margem`}</span>
        </div>
        <div class="ct-kpi-val mono" data-prev-num="${prev.profit ?? ''}">${esc(money(netProfit))}</div>
        <div class="ct-kpi-foot">
          <span>Comissões: <strong class="mono">${esc(money(totalCommissions))}</strong></span>
          <span>Desp.: <strong class="mono">${esc(money(totalExpenses))}</strong></span>
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
        <div class="ct-kpi-val mono" data-prev-num="${prev.appointments ?? ''}">${totals.appointments}</div>
        <div class="ct-bar-track"><div class="ct-bar-fill" style="width:${rate === null ? 0 : occupancyPct}%"></div></div>
        <div class="ct-kpi-foot">
          <span>Clientes: <strong class="mono">${clientsTotal}</strong></span>
          <span>Canc./Faltas: <strong class="mono">${cancelRate}%</strong></span>
        </div>
      </article>
    </section>

    <section class="ct-analytics-grid" aria-label="Gráfico financeiro e desempenho da equipe">
      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Gráfico Financeiro do Período</div>
            <div class="ct-card-sub">Comparativo diário: receita realizada vs prevista (${esc(range.label)})</div>
          </div>
          <a href="#/finance" style="font-size:12px;color:#60A5FA;text-decoration:none">Abrir caixa</a>
        </div>
        ${buildFinancialChartSvg(
          report?.daily,
          state.date,
          Number(totals.revenue_realized || 0),
          Number(totals.revenue_expected || 0)
        )}
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Desempenho dos Profissionais</div>
            <div class="ct-card-sub">Atendimentos concluídos e faturamento</div>
          </div>
          <a href="#/barbers" style="font-size:12px;color:#60A5FA;text-decoration:none">Equipe</a>
        </div>
        <div class="barber-perf-list">
          ${
            barberPerfList.length
              ? barberPerfList
                  .map((b) => {
                    const rev = Number('realized' in b && b.realized !== undefined ? b.realized : b.revenue || 0);
                    const done = Number('completed' in b && b.completed !== undefined ? b.completed : b.total || 0);
                    const pct = Math.max(4, Math.min(100, Math.round((rev / maxBarberRevenue) * 100)));
                    return `
                      <div class="barber-perf-row">
                        <div class="barber-perf-head">
                          <strong>${esc(b.name)}</strong>
                          <span class="mono">${done} atend. · <strong>${esc(money(rev))}</strong></span>
                        </div>
                        <div class="ct-bar-track"><div class="ct-bar-fill" style="width:${pct}%"></div></div>
                      </div>`;
                  })
                  .join('')
              : emptyBlock('Sem atendimentos concluídos', 'Os resultados por profissional aparecerão aqui.')
          }
        </div>
      </article>
    </section>

    <section class="ct-ops-grid" aria-label="Próximos atendimentos, serviços e atividades recentes">
      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Próximos Atendimentos</div>
            <div class="ct-card-sub">Fila confirmada e aguardando</div>
          </div>
          <a href="#/agenda" style="font-size:12px;color:#60A5FA;text-decoration:none">Ver grade</a>
        </div>
        <div class="upcoming-list">
          ${
            upcomingList.length
              ? upcomingList
                  .map(
                    (up) => `
                  <div class="upcoming-item" data-appt="${up.id}">
                    <div class="upcoming-meta">
                      <strong>${esc(up.client_name)}</strong>
                      <span>${esc(formatDateBR(up.date))} às ${esc(up.start_time)} · ${esc(up.service_name || 'Serviço')} (${esc(up.barber_name)})</span>
                    </div>
                    ${statusPill(up.status)}
                  </div>`
                  )
                  .join('')
              : `<div class="muted" style="font-size:12.5px;padding:12px 0">Nenhum próximo horário na fila.</div>`
          }
        </div>
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Serviços Realizados / Mais Pedidos</div>
            <div class="ct-card-sub">Faturamento por serviço no período</div>
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
              : `<div class="muted" style="font-size:12.5px;padding:12px 0">Nenhum serviço concluído neste período.</div>`
          }
        </div>
      </article>

      <article class="ct-card">
        <div class="ct-card-head">
          <div>
            <div class="ct-card-label">Atividades Recentes</div>
            <div class="ct-card-sub">Últimas movimentações na agenda</div>
          </div>
          <a href="#/appointments" style="font-size:12px;color:#60A5FA;text-decoration:none">Todos</a>
        </div>
        <div class="activity-list">
          ${
            recentActivityList.length
              ? recentActivityList
                  .map(
                    (act) => `
                  <div class="activity-item" data-appt="${act.id}">
                    <div class="activity-meta">
                      <strong>${esc(act.start_time)} · ${esc(act.client_name)}</strong>
                      <span>${esc(act.service_name || 'Serviço')} · ${esc(formatDateBR(act.date))}</span>
                    </div>
                    ${statusPill(act.status)}
                  </div>`
                  )
                  .join('')
              : `<div class="muted" style="font-size:12.5px;padding:12px 0">Nenhuma atividade recente registrada.</div>`
          }
        </div>
      </article>
    </section>

    <section class="ct-mid-grid" aria-label="Conversão e status do sistema" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
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

    <article class="card folga-card" aria-label="Dias de folga da barbearia">
      <div class="card-header" style="flex-wrap:wrap;gap:10px">
        <div>
          <h2>Dias de Folga da Barbearia</h2>
          <p class="card-sub">Clique em um dia da semana para alternar entre Aberto e Folga, ou bloqueie uma data específica</p>
        </div>
        <span class="spacer"></span>
        <a href="#/settings" class="btn btn-ghost btn-sm">${icon('settings')} Horários detalhados</a>
      </div>
      <div class="folga-day-grid" id="dash-folga-days">
        ${renderFolgaDayButtons(shopDays, { attr: 'data-dash-folga-w' })}
      </div>
      <div class="folga-closures-row">
        <button class="btn btn-sm ${todayHasClosure ? 'btn-ghost' : 'btn-danger'}" id="dash-close-today" type="button" ${todayHasClosure ? 'disabled' : ''}>
          ${icon('ban')} ${todayHasClosure ? 'Hoje já é Folga' : 'Folgar Hoje'}
        </button>
        <input class="control" type="date" id="dash-closure-date" value="${esc(todayIso)}" aria-label="Data da folga" />
        <input class="control grow" id="dash-closure-reason" placeholder="Motivo da folga (ex: Folga, Feriado)" style="min-width:160px" />
        <button class="btn btn-primary btn-sm" id="dash-add-closure" type="button">${icon('plus')} Marcar folga</button>
      </div>
      ${
        shopClosures.length
          ? `<div class="folga-closure-tags">${shopClosures
              .map(
                (c) => `
              <span class="folga-closure-tag">
                <strong>${esc(formatDateBR(c.date))}</strong>
                <span class="muted">${esc(c.reason || 'Folga')}</span>
                <button type="button" data-dash-del-closure="${c.id}" title="Remover folga" aria-label="Remover folga de ${esc(formatDateBR(c.date))}">&times;</button>
              </span>`
              )
              .join('')}</div>`
          : ''
      }
    </article>

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
          ${(
            [
              ['all', `Todos (${today.total})`],
              ['confirmed', `Confirmados (${today.confirmed})`],
              ['completed', `Concluídos (${today.completed})`],
              ['pending', `Aguardando (${today.pending})`],
              ['cancelled', `Canc./Faltas (${today.cancelled + today.no_show})`],
            ] as const
          )
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

      hydrateLottieElements(targetBody);

      const bindRowClicks = (rootEl: ParentNode): void => {
        rootEl.querySelectorAll<HTMLElement>('[data-appt]').forEach((element) =>
          element.addEventListener('click', () => {
            void (async () => {
              try {
                const appointment = await api.get<Appointment>(`/api/appointments/${element.dataset.appt}`);
                openAppointmentDetails(appointment, {
                  onChanged: () => {
                    void renderDashboardBody({ silent: true });
                  },
                });
              } catch (error: unknown) {
                toast(errorMessage(error), 'error');
              }
            })();
          })
        );
      };

      const renderAgendaTableOnly = (): void => {
        const host = document.getElementById('ct-agenda-body');
        if (!host) return;
        const rows = filterAppts(latestDayAppointments);
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
        hydrateLottieElements(host);
        bindRowClicks(host);
      };

      targetBody.querySelectorAll<HTMLElement>('[data-status-filter]').forEach((btn) =>
        btn.addEventListener('click', () => {
          state.dashStatusFilter = (btn.dataset.statusFilter as DashStatusFilter | undefined) || 'all';
          targetBody
            .querySelectorAll<HTMLElement>('[data-status-filter]')
            .forEach((el) => el.classList.toggle('active', el.dataset.statusFilter === state.dashStatusFilter));
          renderAgendaTableOnly();
        })
      );

      const searchEl = document.getElementById('ct-search-appt') as HTMLInputElement | null;
      searchEl?.addEventListener('input', () => {
        state.dashSearch = searchEl.value;
        renderAgendaTableOnly();
      });

      const gotoDay = (iso: string): void => {
        state.date = iso;
        void renderDashboardBody({ silent: false });
      };
      document.getElementById('dash-prev')?.addEventListener('click', () => gotoDay(addDays(state.date, -1)));
      document.getElementById('dash-next')?.addEventListener('click', () => gotoDay(addDays(state.date, 1)));
      document.getElementById('dash-today')?.addEventListener('click', () => gotoDay(todayISO()));
      const dashDateInput = document.getElementById('dash-date') as HTMLInputElement | null;
      dashDateInput?.addEventListener('change', () => {
        if (dashDateInput.value) gotoDay(dashDateInput.value);
      });
      document.getElementById('dash-open-agenda')?.addEventListener('click', () => {
        location.hash = '#/agenda';
      });

      bindRowClicks(targetBody);

      const bindFolgaDayButtons = (): void => {
        targetBody.querySelectorAll<HTMLButtonElement>('[data-dash-folga-w]').forEach((btn) =>
          btn.addEventListener('click', () => {
            void (async () => {
              const weekday = Number(btn.dataset.dashFolgaW);
              const target = shopDays.find((d) => d.weekday === weekday);
              if (!target) return;
              const nextOpen = !target.is_open;
              const payloadDays = shopDays.map((d) => ({
                weekday: d.weekday,
                is_open: d.weekday === weekday ? nextOpen : d.is_open,
                open_time: d.open_time,
                close_time: d.close_time,
                break_start: d.break_start,
                break_end: d.break_end,
              }));
              targetBody.querySelectorAll<HTMLButtonElement>('[data-dash-folga-w]').forEach((el) => {
                el.disabled = true;
              });
              try {
                const updated = await api.put<BusinessHours[]>('/api/business-hours', { days: payloadDays });
                const normalized = normalizeBusinessDays(updated);
                shopDays.splice(0, shopDays.length, ...normalized);
                const grid = document.getElementById('dash-folga-days');
                if (grid) {
                  grid.innerHTML = renderFolgaDayButtons(shopDays, { attr: 'data-dash-folga-w' });
                  bindFolgaDayButtons();
                  animateFolgaToggle(grid.querySelector<HTMLElement>(`[data-dash-folga-w="${weekday}"]`));
                }
                toast(`${WEEKDAYS_SHORT[weekday] ?? 'Dia'} atualizado para ${nextOpen ? 'Aberto' : 'Folga'}.`);
              } catch (error: unknown) {
                toast(errorMessage(error), 'error');
                targetBody.querySelectorAll<HTMLButtonElement>('[data-dash-folga-w]').forEach((el) => {
                  el.disabled = false;
                });
              }
            })();
          })
        );
      };
      bindFolgaDayButtons();

      document.getElementById('dash-close-today')?.addEventListener('click', (event: MouseEvent) => {
        const reason =
          (document.getElementById('dash-closure-reason') as HTMLInputElement | null)?.value || 'Folga hoje';
        void submitShopClosure(todayIso, reason, event.currentTarget, () => {
          void renderDashboardBody({ silent: true });
        });
      });

      document.getElementById('dash-add-closure')?.addEventListener('click', (event: MouseEvent) => {
        const date = (document.getElementById('dash-closure-date') as HTMLInputElement | null)?.value ?? '';
        const reason =
          (document.getElementById('dash-closure-reason') as HTMLInputElement | null)?.value || 'Folga';
        void submitShopClosure(date, reason, event.currentTarget, () => {
          void renderDashboardBody({ silent: true });
        });
      });

      targetBody.querySelectorAll<HTMLElement>('[data-dash-del-closure]').forEach((btn) =>
        btn.addEventListener('click', () => {
          void (async () => {
            try {
              await api.del(`/api/closures/${btn.dataset.dashDelClosure}`);
              toast('Folga removida.');
              await renderDashboardBody({ silent: true });
            } catch (error: unknown) {
              toast(errorMessage(error), 'error');
            }
          })();
        })
      );

      if (isInitial) {
        animatePanelView(content());
      } else {
        animateNumbers(targetBody);
        animateChartsAndBars(targetBody);
      }
    } finally {
      if (seq === dashRequestSeq) {
        syncHeaderUI(range.label, false);
        const body = document.getElementById('ct-dash-body');
        if (body) body.classList.remove('is-loading');
      }
    }
  };

  document
    .getElementById('ct-dash-header')
    ?.querySelectorAll<HTMLElement>('[data-range]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        const nextRange = btn.dataset.range as DashRangeKey | undefined;
        if (!nextRange || state.dashRange === nextRange) return;
        state.dashRange = nextRange;
        void renderDashboardBody({ silent: false });
      })
    );

  document.getElementById('ct-new-appt')?.addEventListener('click', () => {
    void openAppointmentForm({
      defaults: { date: state.date },
      onSaved: () => {
        void renderDashboardBody({ silent: true });
      },
    });
  });

  document.getElementById('ct-export-csv')?.addEventListener('click', () => {
    const rows = [
      ['Data', 'Horario', 'Cliente', 'Servico', 'Profissional', 'Valor', 'Status'],
      ...latestDayAppointments.map((a) => [
        a.date,
        a.start_time,
        a.client_name,
        a.service_name || '',
        a.barber_name || '',
        String(a.price || 0),
        a.status,
      ]),
    ];
    const csv =
      '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agenda-${state.date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast('CSV exportado com sucesso!', 'ok');
  });

  stopDashboardPolling();
  dashPollTimer = window.setInterval(() => {
    if (!document.hidden && state.view === 'dashboard') {
      void renderDashboardBody({ silent: true });
    }
  }, 7000);
  dashVisibilityHandler = (): void => {
    if (!document.hidden && state.view === 'dashboard') {
      void renderDashboardBody({ silent: true });
    }
  };
  document.addEventListener('visibilitychange', dashVisibilityHandler);

  await renderDashboardBody({ isInitial: true });
}

/* ------------------------------ Profissionais ----------------------------- */

function hoursSummary(barber: Barber): string {
  const working = (barber.hours || []).filter((hour) => Number(hour.is_working));
  if (!working.length) return 'Sem dias de atendimento definidos';
  return working
    .map((hour) => `${WEEKDAYS_SHORT[hour.weekday] ?? ''} ${hour.start_time}-${hour.end_time}`)
    .join(' · ');
}

async function viewBarbers(): Promise<void> {
  await loadCatalog(true);
  const barbers = state.catalog.barbers;

  content().innerHTML = `
    <div class="toolbar">
      <span class="grow"></span>
      <button class="btn btn-primary" id="bb-new" type="button">${icon('plus')} Novo profissional</button>
    </div>
    <div id="barbers-holder"></div>`;

  const holder = document.getElementById('barbers-holder');
  if (!holder) return;

  if (!barbers.length) {
    holder.innerHTML = `<div class="card">${emptyBlock(
      'Nenhum profissional cadastrado',
      'Cadastre a equipe para liberar a agenda e o agendamento online.'
    )}</div>`;
    hydrateLottieElements(holder);
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

  document.getElementById('bb-new')?.addEventListener('click', () => openBarberForm(null));

  holder.querySelectorAll<HTMLElement>('[data-edit]').forEach((element) =>
    element.addEventListener('click', () =>
      openBarberForm(barbers.find((item) => Number(item.id) === Number(element.dataset.edit)) ?? null)
    )
  );
  holder.querySelectorAll<HTMLElement>('[data-hours]').forEach((element) =>
    element.addEventListener('click', () => {
      const target = barbers.find((item) => Number(item.id) === Number(element.dataset.hours));
      if (target) openBarberHours(target);
    })
  );
  holder.querySelectorAll<HTMLElement>('[data-toggle]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        const barber = barbers.find((item) => Number(item.id) === Number(element.dataset.toggle));
        if (!barber) return;
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
          await refresh();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    })
  );
  holder.querySelectorAll<HTMLElement>('[data-del]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        const barber = barbers.find((item) => Number(item.id) === Number(element.dataset.del));
        if (!barber) return;
        const confirmed = await confirmDialog({
          title: 'Excluir profissional',
          message: `Excluir ${barber.name}? Se houver agendamentos, o profissional será apenas desativado.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!confirmed) return;
        try {
          const result = await api.del<{ deactivated?: boolean }>(`/api/barbers/${barber.id}`);
          toast(
            result.deactivated ? 'Profissional possui agendamentos e foi desativado.' : 'Profissional excluído.'
          );
          await refresh();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    })
  );
}

function openBarberForm(barber: Barber | null): void {
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
        if (!data['name']) {
          toast('Informe o nome do profissional.', 'error');
          return;
        }
        const commStr = typeof data['commission'] === 'string' ? data['commission'] : '';
        const payload = {
          name: data['name'],
          phone: data['phone'],
          email: data['email'],
          color: data['color'],
          commission: commStr === '' ? 0 : Number(commStr),
          active: Boolean(data['active']),
        };
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          if (editing && barber) await api.put(`/api/barbers/${barber.id}`, payload);
          else await api.post('/api/barbers', payload);
          modal.close();
          toast(editing ? 'Profissional atualizado.' : 'Profissional cadastrado.');
          await refresh();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

function openBarberHours(barber: Barber): void {
  const rows = [0, 1, 2, 3, 4, 5, 6]
    .map((weekday) => {
      const hour = (barber.hours || []).find((item) => Number(item.weekday) === weekday) ?? {
        weekday,
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
            <span>${esc(WEEKDAYS_SHORT[weekday] ?? '')}</span>
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
          const read = (key: string): HTMLInputElement | null =>
            modal.body.querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="${key}"]`);
          return {
            weekday,
            is_working: Boolean(read('is_working')?.checked),
            start_time: read('start_time')?.value || '09:00',
            end_time: read('end_time')?.value || '19:00',
            break_start: read('break_start')?.value || null,
            break_end: read('break_end')?.value || null,
          };
        });
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          await api.put(`/api/barbers/${barber.id}/hours`, { days });
          modal.close();
          toast('Horários atualizados.');
          await refresh();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

/* --------------------------------- Serviços ------------------------------- */

async function viewServices(): Promise<void> {
  await loadCatalog(true);
  const services = state.catalog.services;

  content().innerHTML = `
    <div class="toolbar">
      <span class="grow"></span>
      <button class="btn btn-primary" id="sv-new" type="button">${icon('plus')} Novo serviço</button>
    </div>
    <div id="services-holder"></div>`;

  const holder = document.getElementById('services-holder');
  if (!holder) return;

  if (!services.length) {
    holder.innerHTML = `<div class="table-wrap">${emptyBlock(
      'Nenhum serviço cadastrado',
      'Cadastre os serviços com duração e preço para permitir agendamentos.'
    )}</div>`;
    hydrateLottieElements(holder);
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

  document.getElementById('sv-new')?.addEventListener('click', () => openServiceForm(null));

  holder.querySelectorAll<HTMLElement>('[data-edit]').forEach((element) =>
    element.addEventListener('click', () =>
      openServiceForm(services.find((item) => Number(item.id) === Number(element.dataset.edit)) ?? null)
    )
  );
  holder.querySelectorAll<HTMLElement>('[data-toggle]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        const service = services.find((item) => Number(item.id) === Number(element.dataset.toggle));
        if (!service) return;
        try {
          await api.put(`/api/services/${service.id}`, {
            name: service.name,
            description: service.description,
            duration_min: Number(service.duration_min),
            price: Number(service.price),
            active: !Number(service.active),
          });
          toast('Serviço atualizado.');
          await refresh();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    })
  );
  holder.querySelectorAll<HTMLElement>('[data-del]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        const service = services.find((item) => Number(item.id) === Number(element.dataset.del));
        if (!service) return;
        const confirmed = await confirmDialog({
          title: 'Excluir serviço',
          message: `Excluir ${service.name}? Se houver agendamentos, o serviço será apenas desativado.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!confirmed) return;
        try {
          const result = await api.del<{ deactivated?: boolean }>(`/api/services/${service.id}`);
          toast(result.deactivated ? 'Serviço possui agendamentos e foi desativado.' : 'Serviço excluído.');
          await refresh();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    })
  );
}

function openServiceForm(service: Service | null): void {
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
        const priceStr = typeof data['price'] === 'string' ? data['price'] : '';
        if (!data['name']) {
          toast('Informe o nome do serviço.', 'error');
          return;
        }
        if (priceStr === '') {
          toast('Informe o preço do serviço.', 'error');
          return;
        }
        const payload = {
          name: data['name'],
          description: data['description'],
          duration_min: Number(data['duration_min'] || 30),
          price: Number(priceStr),
          active: Boolean(data['active']),
        };
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          if (editing && service) await api.put(`/api/services/${service.id}`, payload);
          else await api.post('/api/services', payload);
          modal.close();
          toast(editing ? 'Serviço atualizado.' : 'Serviço cadastrado.');
          await refresh();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

/* --------------------------------- Backup --------------------------------- */

async function viewBackup(): Promise<void> {
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

  document.getElementById('backup-export')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      setBusy(event.currentTarget, true, 'Gerando...');
      try {
        const backup = await api.get<BackupResponse>('/api/backup');
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
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  document.getElementById('backup-import')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      const input = document.getElementById('backup-file') as HTMLInputElement | null;
      const mode = (document.getElementById('backup-mode') as HTMLSelectElement | null)?.value || 'merge';
      const file = input?.files?.[0];
      if (!file) {
        toast('Escolha um arquivo de backup.', 'error');
        return;
      }

      let parsed: { data?: unknown; backup?: { data?: unknown } };
      try {
        parsed = JSON.parse(await file.text()) as { data?: unknown; backup?: { data?: unknown } };
      } catch {
        toast('O arquivo selecionado não é um JSON válido.', 'error');
        return;
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
        const result = await api.post<{ counts?: Record<string, number> }>('/api/backup/import', {
          mode,
          data: parsed.data || parsed.backup?.data || parsed,
        });
        const total = Object.values(result.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
        toast(`${total} registro(s) restaurado(s).`);
        await loadCatalog(true);
        await refresh();
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
        setBusy(event.currentTarget, false);
      }
    })();
  });

  document.getElementById('backup-health')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      const box = document.getElementById('backup-health-box');
      if (!box) return;
      setBusy(event.currentTarget, true, 'Verificando...');
      try {
        const health = await api.get<HealthResponse>('/health');
        box.innerHTML = `
          <div class="booking-summary">
            <div><span>Status</span><strong>${esc(health.status)}</strong></div>
            <div><span>Banco</span><strong>${esc(health.driver || '-')}</strong></div>
            <div><span>Destino</span><strong>${esc(health.target || '-')}</strong></div>
            <div><span>Ambiente</span><strong>${esc(health.environment || '-')}</strong></div>
            <div><span>Ativo há</span><strong>${Math.round(Number(health.uptime_seconds || 0))}s</strong></div>
          </div>`;
      } catch (error: unknown) {
        box.innerHTML = `<span class="muted">${esc(errorMessage(error))}</span>`;
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });
}

function renderBackupMeta(meta?: BackupMeta): void {
  const el = document.getElementById('backup-meta');
  if (!meta || !el) return;
  const counts = Object.entries(meta.counts || {})
    .map(([table, total]) => `<div><span>${esc(table)}</span><strong class="mono">${Number(total)}</strong></div>`)
    .join('');
  el.innerHTML = `
    <div class="booking-summary">
      <div><span>Gerado em</span><strong>${esc(new Date(meta.generated_at).toLocaleString('pt-BR'))}</strong></div>
      <div><span>Banco</span><strong>${esc(meta.driver || '-')}</strong></div>
      ${counts}
    </div>`;
}

/* --------------------------------- Roteador ------------------------------- */

const VIEWS: Record<ViewKey, () => Promise<void>> = {
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
};

function currentViewFromHash(): ViewKey | 'login' {
  const params = new URLSearchParams(window.location.search);
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0] || params.get('view') || '';
  if (raw === 'login') return 'login';
  const match = NAV.find((item) => item.key === raw);
  return match ? match.key : 'dashboard';
}

/* ---------------------------------- Boot ---------------------------------- */

async function startApp(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `<div class="boot-screen"><div class="lottie-box lottie-sm" data-lottie="loading"><div class="spinner"></div></div><span>Preparando o painel...</span></div>`;
  hydrateLottieElements(root);

  try {
    state.settings = await api.get<Settings>('/api/settings');
  } catch (error: unknown) {
    if (errorStatus(error) === 401) {
      renderLogin();
      return;
    }
    state.settings = {};
  }

  state.date = todayISO();
  root.innerHTML = shellHtml();
  wireShell();
  animateShellBoot();
  const initialView = currentViewFromHash();
  await navigate(initialView === 'login' ? 'dashboard' : initialView);
}

registerPanelHooks({ navigate: navigateToView, renderLogin });

function boot(): void {
  initGsapMotion();
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `<div class="boot-screen"><div class="lottie-box lottie-sm" data-lottie="loading"><div class="spinner"></div></div><span>Carregando o Gestor de Barbearia...</span></div>`;
  hydrateLottieElements(root);

  api
    .get<AuthMeResponse>('/api/auth/me')
    .then((me) => {
      state.me = me;
      if (!me.authenticated || currentViewFromHash() === 'login') {
        renderLogin();
        return;
      }
      return startApp();
    })
    .catch((error: unknown) => {
      root.innerHTML = `
        <div class="boot-screen">
          <div class="brand-mark" style="width:52px;height:52px;font-size:17px">GB</div>
          <strong>Não foi possível iniciar o painel</strong>
          <span>${esc(errorMessage(error))}</span>
          <button class="btn" id="boot-retry" type="button">Tentar novamente</button>
        </div>`;
      document.getElementById('boot-retry')?.addEventListener('click', boot);
    });
}

window.addEventListener('hashchange', () => {
  if (!document.getElementById('content')) return;
  const target = currentViewFromHash();
  if (target === 'login') {
    renderLogin();
    return;
  }
  void navigate(target);
});

window.addEventListener('appointments:changed', () => {
  if (state.view === 'agenda' || state.view === 'appointments' || state.view === 'dashboard') {
    void refresh();
  }
});

boot();
