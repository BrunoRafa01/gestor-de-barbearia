// Utilitários de interface: formatação, ícones Lucide, modais, avisos e elementos.

/* -------------------------------- Ícones Lucide -------------------------- */

const SVG = {
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
};

export function icon(name, extra = '') {
  const path = SVG[name] || '';
  const cls = `lucide lucide-${name}${extra ? ` ${extra}` : ''}`;
  return `<svg class="${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* ------------------------------ Segurança -------------------------------- */

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

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAYS_LONG = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];
export const MONTHS_LONG = [
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
    toast('Cliente sem telefone válido cadastrado.', 'error');
    return;
  }
  window.open(link, '_blank', 'noopener');
}

/* -------------------------------- Status --------------------------------- */

export const STATUS_META = {
  pending: { label: 'Aguardando', className: 'pill pill-pending' },
  confirmed: { label: 'Confirmado', className: 'pill pill-confirmed' },
  completed: { label: 'Concluído', className: 'pill pill-completed' },
  cancelled: { label: 'Cancelado', className: 'pill pill-cancelled' },
  no_show: { label: 'Não compareceu', className: 'pill pill-no_show' },
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
  const toastIcon =
    type === 'error'
      ? icon('ban')
      : type === 'warn'
      ? icon('alert-triangle')
      : icon('check');
  node.innerHTML = `<span class="toast-icon">${toastIcon}</span><span>${esc(message)}</span>`;
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
        <button type="button" class="icon-btn" data-close aria-label="Fechar modal">${icon('x')}</button>
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
