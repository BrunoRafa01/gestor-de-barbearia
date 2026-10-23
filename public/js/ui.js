// Utilitarios de interface: formatacao, icones, modais, avisos e elementos.

/* -------------------------------- Icones --------------------------------- */

const SVG = {
  dashboard: '<path d="M4 4h7v7H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 13h7v7H4z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6 1.65 1.65 0 0 0 4.27 6.78l-.06-.06A2 2 0 1 1 7.04 3.9l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  whatsapp: '<path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.16L2 22l4.98-1.6A9.9 9.9 0 1 0 12.04 2z"/><path d="M8.5 7.9c.2-.5.9-.6 1.2-.2l.9 1.3c.2.3.1.6-.1.8l-.5.5c-.2.2-.2.4-.1.6.4.9 1.2 1.7 2.1 2.1.2.1.5 0 .6-.1l.5-.5c.2-.2.6-.3.8-.1l1.3.9c.4.3.3 1-.2 1.2-1.6.7-3.9-.6-5.2-2s-2.7-3.6-2-5.2z"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l3-4 3 3 4-6"/>',
  wallet: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20M16 14h2"/>',
  sparkles: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M19 15l.9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
};

export function icon(name, extra = '') {
  const path = SVG[name] || '';
  return `<svg class="${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* ------------------------------ Seguranca -------------------------------- */

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------- Formatos -------------------------------- */

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
export const WEEKDAYS_LONG = [
  'Domingo',
  'Segunda-feira',
  'Terca-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sabado',
];
export const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'marco',
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

export function money(value) {
  return moneyFormatter.format(Number(value || 0));
}

export function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseISO(value) {
  return new Date(`${value}T12:00:00`);
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, days) {
  const date = parseISO(iso);
  date.setDate(date.getDate() + Number(days));
  return toISO(date);
}

export function formatDateBR(iso) {
  if (!iso) return '';
  const [year, month, day] = String(iso).split('-');
  return `${day}/${month}/${year}`;
}

export function formatDateLong(iso) {
  if (!iso) return '';
  const date = parseISO(iso);
  return `${WEEKDAYS_LONG[date.getDay()]}, ${formatDateBR(iso)}`;
}

export function formatMonthYear(iso) {
  const date = parseISO(iso);
  return `${MONTHS_LONG[date.getMonth()]} de ${date.getFullYear()}`;
}

export function startOfWeek(iso) {
  const date = parseISO(iso);
  const weekday = date.getDay();
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

export function hhmmToMinutes(value) {
  const [hours, minutes] = String(value || '0:0').split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToHHMM(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function formatPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw || '';
}

export function waLink(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(message || '')}`;
}

export function openWhatsapp(phone, message) {
  const link = waLink(phone, message);
  if (!link) {
    toast('Cliente sem telefone valido cadastrado.', 'error');
    return;
  }
  window.open(link, '_blank', 'noopener');
}

/* -------------------------------- Status --------------------------------- */

export const STATUS_META = {
  pending: { label: 'Aguardando', className: 'pill pill-pending' },
  confirmed: { label: 'Confirmado', className: 'pill pill-confirmed' },
  completed: { label: 'Concluido', className: 'pill pill-completed' },
  cancelled: { label: 'Cancelado', className: 'pill pill-cancelled' },
  no_show: { label: 'Nao compareceu', className: 'pill pill-no_show' },
};

export function statusPill(status) {
  const meta = STATUS_META[status] || { label: status, className: 'pill pill-neutral' };
  return `<span class="${meta.className}">${meta.label}</span>`;
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/* --------------------------------- Avisos -------------------------------- */

function toastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

export function toast(message, type = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<span class="toast-icon">${type === 'error' ? '!' : '✓'}</span><span>${esc(message)}</span>`;
  toastStack().appendChild(node);
  setTimeout(() => node.remove(), 4600);
}

/* --------------------------------- Modais -------------------------------- */

export function openModal({ title, body = '', footer = null, narrow = false, onClose = null }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal${narrow ? ' narrow' : ''}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3></h3>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close>${icon('x')}</button>
      </div>
      <div class="modal-body"></div>
    </div>`;

  const modal = backdrop.querySelector('.modal');
  modal.querySelector('h3').textContent = title || '';

  const bodyElement = modal.querySelector('.modal-body');
  if (body instanceof Node) bodyElement.appendChild(body);
  else bodyElement.innerHTML = body || '';

  const closeHandlers = [];
  function close() {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    if (!document.querySelector('.modal-backdrop')) document.body.style.overflow = '';
    closeHandlers.forEach((handler) => handler());
  }

  function setFooter(nodes) {
    let footerElement = modal.querySelector('.modal-footer');
    if (!footerElement) {
      footerElement = document.createElement('div');
      footerElement.className = 'modal-footer';
      modal.appendChild(footerElement);
    }
    footerElement.innerHTML = '';
    const list = Array.isArray(nodes) ? nodes : [nodes];
    list.forEach((node) => {
      if (node) footerElement.appendChild(node);
    });
    return footerElement;
  }

  if (footer) setFooter(footer);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', close);

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);
  closeHandlers.push(() => document.removeEventListener('keydown', onKeydown));

  document.body.style.overflow = 'hidden';
  document.body.appendChild(backdrop);

  const firstField = bodyElement.querySelector('input, select, textarea');
  if (firstField) setTimeout(() => firstField.focus(), 60);

  return {
    close,
    setFooter,
    root: modal,
    body: bodyElement,
    onClose: (handler) => closeHandlers.push(handler),
  };
}

export function button(label, onClick, className = 'btn') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.innerHTML = label;
  if (onClick) element.addEventListener('click', onClick);
  return element;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const modal = openModal({ title, narrow: true, body: `<p class="muted">${esc(message)}</p>` });
    modal.setFooter([
      button('Cancelar', () => {
        modal.close();
        finish(false);
      }, 'btn btn-ghost'),
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

/* ------------------------------- Formularios ----------------------------- */

export function readForm(container) {
  const data = {};
  container.querySelectorAll('[name]').forEach((field) => {
    if (field.type === 'checkbox') data[field.name] = field.checked;
    else data[field.name] = field.value.trim();
  });
  return data;
}

export function setBusy(buttonElement, busy, busyLabel = 'Salvando...') {
  if (!buttonElement) return;
  if (busy) {
    buttonElement.dataset.label = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.textContent = busyLabel;
  } else {
    buttonElement.disabled = false;
    if (buttonElement.dataset.label) buttonElement.innerHTML = buttonElement.dataset.label;
  }
}

export function debounce(fn, delay = 320) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function spinnerBlock(label = 'Carregando...') {
  return `<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>${esc(label)}</div>`;
}

export function emptyBlock(title, message = '') {
  return `<div class="empty"><strong>${esc(title)}</strong>${message ? esc(message) : ''}</div>`;
}
