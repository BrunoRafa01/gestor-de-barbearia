/**
 * Utilitários de interface TypeScript: formatação, ícones Lucide, Skeleton Loading,
 * Lottie states, modais acessíveis (Escape + Focus Trap), toasts e assinatura NOVA RUNTIME.
 */

import {
  animateModalClose,
  animateModalOpen,
  animateToastIn,
  hydrateLottieElements,
} from '../animations/index.js';
import { esc, safeUrl } from './escape.js';
import type { AppointmentStatus } from './types.js';

export { esc, safeUrl };

/* -------------------------------- Ícones Lucide -------------------------- */

const SVG: Record<string, string> = {
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  whatsapp: '<path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.16L2 22l4.98-1.6A9.9 9.9 0 1 0 12.04 2z"/><path d="M8.5 7.9c.2-.5.9-.6 1.2-.2l.9 1.3c.2.3.1.6-.1.8l-.5.5c-.2.2-.2.4-.1.6.4.9 1.2 1.7 2.1 2.1.2.1.5 0 .6-.1l.5-.5c.2-.2.6-.3.8-.1l1.3.9c.4.3.3 1-.2 1.2-1.6.7-3.9-.6-5.2-2s-2.7-3.6-2-5.2z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  chart: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
};

export function icon(name: string, extra = ''): string {
  const path = SVG[name] ?? '';
  const cls = `lucide lucide-${name}${extra ? ` ${extra}` : ''}`;
  return `<svg class="${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* ------------------------------ Segurança -------------------------------- */

/* ------------------------------- Formatos -------------------------------- */

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const WEEKDAYS_SHORT: readonly string[] = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAYS_LONG: readonly string[] = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];
export const MONTHS_LONG: readonly string[] = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function money(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  return moneyFormatter.format(Number.isFinite(num) ? num : 0);
}

const APP_TIMEZONE = 'America/Fortaleza';

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timePartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function toISO(date: Date): string {
  return isoFormatter.format(date);
}

export function nowMinutesAppTz(now: Date = new Date()): number {
  const parts: Record<string, string> = {};
  for (const part of timePartsFormatter.formatToParts(now)) {
    parts[part.type] = part.value;
  }
  const hour = Number(parts['hour'] === '24' ? 0 : (parts['hour'] ?? 0));
  const minute = Number(parts['minute'] ?? 0);
  return hour * 60 + minute;
}

export function parseISO(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function weekdayOfISO(iso: string): number {
  return parseISO(iso).getDay();
}

export function addDays(iso: string, days: number): string {
  const date = parseISO(iso);
  date.setDate(date.getDate() + Number(days));
  return toISO(date);
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = String(iso).split('-');
  const year = parts[0] ?? '';
  const month = parts[1] ?? '';
  const day = parts[2] ?? '';
  return `${day}/${month}/${year}`;
}

export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = parseISO(iso);
  const wd = WEEKDAYS_LONG[date.getDay()] ?? '';
  return `${wd}, ${formatDateBR(iso)}`;
}

export function formatMonthYear(iso: string): string {
  const date = parseISO(iso);
  const month = MONTHS_LONG[date.getMonth()] ?? '';
  return `${month} de ${date.getFullYear()}`;
}

export function startOfWeek(iso: string): string {
  const date = parseISO(iso);
  const weekday = date.getDay();
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

export function hhmmToMinutes(value: string | null | undefined): number {
  const parts = String(value || '0:0').split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  return hours * 60 + minutes;
}

export function minutesToHHMM(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function formatPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw ?? '';
}

export function waLink(phone: string | null | undefined, message = ''): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}

export function openWhatsapp(phone: string | null | undefined, message = ''): void {
  const link = waLink(phone, message);
  if (!link) {
    toast('Cliente sem telefone válido cadastrado.', 'error');
    return;
  }
  window.open(link, '_blank', 'noopener');
}

/* -------------------------------- Status --------------------------------- */

export interface StatusMetaInfo {
  label: string;
  className: string;
}

export const STATUS_META: Record<AppointmentStatus, StatusMetaInfo> = {
  pending: { label: 'Aguardando', className: 'pill pill-pending' },
  confirmed: { label: 'Confirmado', className: 'pill pill-confirmed' },
  completed: { label: 'Concluído', className: 'pill pill-completed' },
  cancelled: { label: 'Cancelado', className: 'pill pill-cancelled' },
  no_show: { label: 'Não compareceu', className: 'pill pill-no_show' },
};

export function statusPill(status: string): string {
  const meta = (STATUS_META as Record<string, StatusMetaInfo | undefined>)[status] ?? {
    label: status,
    className: 'pill pill-neutral',
  };
  return `<span class="${meta.className}">${esc(meta.label)}</span>`;
}

export function initials(name: string | null | undefined): string {
  const cleaned = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();
  if (!cleaned) return '?';
  return cleaned
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

/* --------------------------------- Avisos -------------------------------- */

export type ToastType = 'ok' | 'success' | 'warn' | 'error';

function toastStack(): HTMLElement {
  let stack = document.querySelector<HTMLElement>('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    stack.setAttribute('aria-atomic', 'false');
    document.body.appendChild(stack);
  }
  return stack;
}

export function toast(message: string, type: ToastType = 'ok'): void {
  const normalizedType = type === 'success' ? 'ok' : type;
  const node = document.createElement('div');
  node.className = `toast ${normalizedType}`;
  node.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');
  node.setAttribute('aria-live', normalizedType === 'error' || normalizedType === 'warn' ? 'assertive' : 'polite');
  const toastIcon =
    normalizedType === 'error'
      ? icon('ban')
      : normalizedType === 'warn'
        ? icon('alert-triangle')
        : icon('check');
  node.innerHTML = `<span class="toast-icon">${toastIcon}</span><span>${esc(message)}</span>`;
  toastStack().appendChild(node);
  animateToastIn(node);
  window.setTimeout(() => node.remove(), 4600);
}

/* --------------------------------- Modais -------------------------------- */

export interface ModalOptions {
  title: string;
  body?: string | Node;
  footer?: HTMLElement | Array<HTMLElement | null | undefined> | null;
  narrow?: boolean;
  onClose?: (() => void) | null;
}

export interface ModalHandle {
  close: () => void;
  setFooter: (nodes: HTMLElement | Array<HTMLElement | null | undefined>) => HTMLElement;
  root: HTMLElement;
  body: HTMLElement;
  onClose: (handler: () => void) => void;
}

export function openModal({
  title,
  body = '',
  footer = null,
  narrow = false,
  onClose = null,
}: ModalOptions): ModalHandle {
  const triggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal${narrow ? ' narrow' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-header">
        <h3 id="${titleId}"></h3>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close aria-label="Fechar modal">${icon('x')}</button>
      </div>
      <div class="modal-body"></div>
    </div>`;

  const modal = backdrop.querySelector<HTMLElement>('.modal')!;
  const heading = modal.querySelector<HTMLElement>('h3')!;
  heading.textContent = title || '';

  const bodyElement = modal.querySelector<HTMLElement>('.modal-body')!;
  if (body instanceof Node) {
    bodyElement.appendChild(body);
  } else {
    bodyElement.innerHTML = body || '';
  }

  const closeHandlers: Array<() => void> = [];
  if (typeof onClose === 'function') closeHandlers.push(onClose);
  let closing = false;

  function close(): void {
    if (!backdrop.isConnected || closing) return;
    closing = true;
    animateModalClose(backdrop, modal, () => {
      backdrop.remove();
      if (!document.querySelector('.modal-backdrop')) {
        document.body.style.overflow = '';
      }
      closeHandlers.forEach((handler) => handler());
      if (triggerEl && triggerEl.isConnected) {
        triggerEl.focus();
      }
    });
  }

  function setFooter(nodes: HTMLElement | Array<HTMLElement | null | undefined>): HTMLElement {
    let footerElement = modal.querySelector<HTMLElement>('.modal-footer');
    if (!footerElement) {
      footerElement = document.createElement('div');
      footerElement.className = 'modal-footer';
      modal.appendChild(footerElement);
    }
    footerElement.innerHTML = '';
    const list = Array.isArray(nodes) ? nodes : [nodes];
    list.forEach((node) => {
      if (node) footerElement!.appendChild(node);
    });
    return footerElement;
  }

  if (footer) setFooter(footer);

  backdrop.addEventListener('click', (event: MouseEvent) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', close);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('keydown', onKeydown);
  closeHandlers.push(() => document.removeEventListener('keydown', onKeydown));

  document.body.style.overflow = 'hidden';
  document.body.appendChild(backdrop);
  animateModalOpen(backdrop, modal);

  const firstField =
    bodyElement.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ||
    modal.querySelector<HTMLElement>('.modal-footer button:not([disabled]), [data-close]');
  if (firstField) {
    window.setTimeout(() => firstField.focus(), 60);
  }

  return {
    close,
    setFooter,
    root: modal,
    body: bodyElement,
    onClose: (handler: () => void) => {
      closeHandlers.push(handler);
    },
  };
}

export function button(
  label: string,
  onClick?: ((event: MouseEvent) => void | Promise<void>) | null,
  className = 'btn'
): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.innerHTML = label;
  if (onClick) {
    element.addEventListener('click', (ev) => {
      void onClick(ev);
    });
  }
  return element;
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function confirmDialog(
  optionsOrTitle: ConfirmDialogOptions | string,
  fallbackMessage = ''
): Promise<boolean> {
  const opts: ConfirmDialogOptions =
    typeof optionsOrTitle === 'string'
      ? { title: optionsOrTitle, message: fallbackMessage, confirmLabel: 'Confirmar', danger: true }
      : optionsOrTitle;
  const { title, message, confirmLabel = 'Confirmar', danger = false } = opts;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const modal = openModal({
      title,
      narrow: true,
      body: `<p class="muted">${esc(message)}</p>`,
    });
    modal.setFooter([
      button(
        'Cancelar',
        () => {
          modal.close();
          finish(false);
        },
        'btn btn-ghost'
      ),
      button(
        confirmLabel,
        () => {
          modal.close();
          finish(true);
        },
        danger ? 'btn btn-danger' : 'btn btn-primary'
      ),
    ]);
    modal.onClose(() => finish(false));
  });
}

/* ------------------------------- Formulários ----------------------------- */

export type FormValues = Record<string, string | boolean>;

export function readForm(container: ParentNode): FormValues {
  const data: FormValues = {};
  container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name]').forEach((field) => {
    if (!field.name) return;
    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      data[field.name] = field.checked;
    } else {
      data[field.name] = field.value.trim();
    }
  });
  return data;
}

export function setBusy(
  buttonElement: EventTarget | HTMLElement | null | undefined,
  busy: boolean,
  busyLabel = 'Salvando...'
): void {
  if (!(buttonElement instanceof HTMLElement)) return;
  const btn = buttonElement as HTMLButtonElement;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = busyLabel;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay = 320
): (...args: Args) => void {
  let timer: number | undefined;
  return (...args: Args) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

/* ---------------- Estados Visuais, Skeletons & Assinatura ---------------- */

export function spinnerBlock(label = 'Carregando...'): string {
  return `
    <div class="empty" data-loading="1">
      <div class="lottie-box lottie-sm" data-lottie="loading">
        <div class="spinner"></div>
      </div>
      <div>${esc(label)}</div>
    </div>`;
}

export function emptyBlock(title: string, message = ''): string {
  return `
    <div class="empty">
      <div class="lottie-box lottie-md" data-lottie="empty"></div>
      <strong>${esc(title)}</strong>
      ${message ? `<span>${esc(message)}</span>` : ''}
    </div>`;
}

export function skeletonCards(count = 3): string {
  const items = Array.from({ length: Math.max(1, count) })
    .map(
      () => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-val"></div>
        <div class="skeleton skeleton-line w-80"></div>
        <div class="skeleton skeleton-line w-60"></div>
      </div>`
    )
    .join('');
  return `<div class="grid grid-3" data-skeleton="1" aria-busy="true">${items}</div>`;
}

export function skeletonTable(rows = 6): string {
  const items = Array.from({ length: Math.max(1, rows) })
    .map(
      () => `
      <div class="skeleton-table-row">
        <div class="skeleton skeleton-line w-80"></div>
        <div class="skeleton skeleton-line w-80"></div>
        <div class="skeleton skeleton-line w-60"></div>
        <div class="skeleton skeleton-line w-60"></div>
        <div class="skeleton skeleton-line w-40"></div>
      </div>`
    )
    .join('');
  return `
    <div class="card" data-skeleton="1" aria-busy="true">
      <div class="skeleton skeleton-line w-40" style="margin-bottom:14px"></div>
      ${items}
    </div>`;
}

export function skeletonDashboard(): string {
  const kpis = Array.from({ length: 4 })
    .map(
      () => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-val"></div>
        <div class="skeleton skeleton-line w-60"></div>
      </div>`
    )
    .join('');
  return `
    <div data-skeleton="1" aria-busy="true">
      <div class="ct-kpi-grid">${kpis}</div>
      <div class="ct-analytics-grid">
        <div class="skeleton-card" style="min-height:220px">
          <div class="skeleton skeleton-line w-40"></div>
          <div class="skeleton" style="height:150px;margin-top:14px"></div>
        </div>
        <div class="skeleton-card" style="min-height:220px">
          <div class="skeleton skeleton-line w-60"></div>
          <div class="skeleton skeleton-line w-80" style="margin-top:16px"></div>
          <div class="skeleton skeleton-line w-60" style="margin-top:12px"></div>
          <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        </div>
      </div>
      <div style="margin-top:14px">${skeletonTable(5)}</div>
    </div>`;
}

export function novaRuntimeSignature(): string {
  return `<div class="nr-signature">Desenvolvido por <strong>NOVA RUNTIME</strong></div>`;
}

export { hydrateLottieElements };
