/**
 * Contexto compartilhado entre as views do painel administrativo — NOVA RUNTIME
 */

import { api, errorMessage, errorStatus } from './api.js';
import type { AuthMeResponse, Barber, Service, Settings } from './types.js';
import { addDays, confirmDialog, esc, icon, setBusy, startOfWeek, STATUS_META, toast, todayISO } from './ui.js';

export type ViewKey =
  | 'dashboard'
  | 'agenda'
  | 'appointments'
  | 'clients'
  | 'finance'
  | 'reports'
  | 'marketing'
  | 'barbers'
  | 'services'
  | 'settings'
  | 'backup';

export type DashRangeKey = 'today' | '7d' | '30d' | 'month';
export type DashStatusFilter = 'all' | 'confirmed' | 'completed' | 'pending' | 'cancelled';
export type AgendaMode = 'day' | 'week';

export interface AppointmentFilters {
  from: string;
  to: string;
  status: string;
  barber_id: string;
  search: string;
}

export interface ReportFilters {
  from: string;
  to: string;
  barber_id: string;
}

export interface AppState {
  me: AuthMeResponse | null;
  settings: Settings;
  view: ViewKey;
  date: string;
  mode: AgendaMode;
  barberFilter: string;
  dashRange: DashRangeKey;
  dashStatusFilter: DashStatusFilter;
  dashSearch: string;
  catalog: {
    loaded: boolean;
    barbers: Barber[];
    services: Service[];
  };
  appointmentFilters: AppointmentFilters | null;
  reportFilters: ReportFilters | null;
}

export const ROW_MINUTES = 30;
export const ROW_HEIGHT = 46;

export const state: AppState = {
  me: null,
  settings: {},
  view: 'dashboard',
  date: todayISO(),
  mode: 'day',
  barberFilter: '',
  dashRange: '30d',
  dashStatusFilter: 'all',
  dashSearch: '',
  catalog: { loaded: false, barbers: [], services: [] },
  appointmentFilters: null,
  reportFilters: null,
};

export function content(): HTMLElement {
  const el = document.getElementById('content');
  if (!el) throw new Error('Container #content não encontrado.');
  return el;
}

let navigateHandler: ((view: ViewKey) => Promise<void>) | null = null;
let loginRenderer: (() => void) | null = null;

export function registerPanelHooks(hooks: {
  navigate: (view: ViewKey) => Promise<void>;
  renderLogin: () => void;
}): void {
  navigateHandler = hooks.navigate;
  loginRenderer = hooks.renderLogin;
}

export function navigate(view: ViewKey): Promise<void> {
  if (!navigateHandler) return Promise.resolve();
  return navigateHandler(view);
}

export const refresh = (): Promise<void> => navigate(state.view);

export function triggerLoginScreen(): void {
  loginRenderer?.();
}

export function optionsFrom<T>(
  list: T[],
  selected: string | number | null | undefined,
  labelFn: (item: T) => string,
  valueFn: (item: T) => string | number = (item) => (item as unknown as { id: string | number }).id
): string {
  return list
    .map((item) => {
      const value = String(valueFn(item));
      const isSelected = String(selected ?? '') === value ? ' selected' : '';
      return `<option value="${esc(value)}"${isSelected}>${esc(labelFn(item))}</option>`;
    })
    .join('');
}

export function statusOptions(selected: string): string {
  return Object.entries(STATUS_META)
    .map(
      ([key, meta]) =>
        `<option value="${key}"${key === selected ? ' selected' : ''}>${esc(meta.label)}</option>`
    )
    .join('');
}

export async function loadCatalog(force = false): Promise<void> {
  if (state.catalog.loaded && !force) return;
  const [barbers, services] = await Promise.all([
    api.get<Barber[]>('/api/barbers'),
    api.get<Service[]>('/api/services'),
  ]);
  state.catalog = { loaded: true, barbers, services };
}

export interface KpiCardOptions {
  label: string;
  value: string | number;
  foot?: string;
  small?: boolean;
  iconName?: string | null;
}

export function kpi({ label, value, foot = '', small = false, iconName = null }: KpiCardOptions): string {
  return `
    <div class="kpi">
      ${iconName ? `<div class="kpi-icon">${icon(iconName)}</div>` : ''}
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value${small ? ' small' : ''}">${value}</div>
      ${foot ? `<div class="kpi-foot">${foot}</div>` : ''}
    </div>`;
}

export function weekDates(iso: string): string[] {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export async function submitShopClosure(
  date: string,
  reason: string,
  triggerBtn: EventTarget | HTMLElement | null,
  onDone?: () => void
): Promise<void> {
  if (!date) {
    toast('Informe a data da folga.', 'error');
    return;
  }
  if (triggerBtn) setBusy(triggerBtn, true);
  try {
    await api.post('/api/closures', { date, reason });
    toast('Dia de folga registrado com sucesso.');
    if (onDone) onDone();
  } catch (error: unknown) {
    if (triggerBtn) setBusy(triggerBtn, false);
    const msg = errorMessage(error);
    if (errorStatus(error) === 409 && msg.toLowerCase().includes('agendamentos ativos')) {
      const confirmed = await confirmDialog({
        title: 'Existem agendamentos nesta data',
        message: `${msg} Deseja cancelar esses agendamentos automaticamente e registrar a folga mesmo assim?`,
        confirmLabel: 'Cancelar agendamentos e fechar dia',
        danger: true,
      });
      if (confirmed) {
        try {
          await api.post('/api/closures', { date, reason, force: true });
          toast('Folga registrada e agendamentos do dia cancelados.');
          if (onDone) onDone();
        } catch (err2: unknown) {
          toast(errorMessage(err2), 'error');
        }
      }
      return;
    }
    toast(msg, 'error');
  }
}
