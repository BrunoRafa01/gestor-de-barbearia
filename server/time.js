// Utilitarios de data/hora. Todas as datas sao tratadas como texto "YYYY-MM-DD"
// e todos os horarios como texto "HH:MM", sempre no fuso local do servidor.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAYS = [
  'Domingo',
  'Segunda-feira',
  'Terca-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sabado',
];

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

export function isValidDate(value) {
  if (!DATE_RE.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && toISODate(parsed) === value;
}

export function isValidTime(value) {
  return TIME_RE.test(String(value || ''));
}

export function hhmmToMinutes(value) {
  const match = TIME_RE.exec(String(value || ''));
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToHHMM(minutes) {
  const total = Math.round(Number(minutes));
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Converte um objeto Date para "YYYY-MM-DD" usando o fuso local. */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

export function parseDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}

/** 0 = domingo ... 6 = sabado */
export function weekdayOf(dateStr) {
  return parseDate(dateStr).getDay();
}

export function addDays(dateStr, days) {
  const base = parseDate(dateStr);
  base.setDate(base.getDate() + Number(days));
  return toISODate(base);
}

/** Retorna a segunda-feira da semana da data informada. */
export function startOfWeek(dateStr) {
  const weekday = weekdayOf(dateStr);
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return addDays(dateStr, diff);
}

export function endOfWeek(dateStr) {
  return addDays(startOfWeek(dateStr), 6);
}

export function formatDateBR(dateStr) {
  if (!isValidDate(dateStr)) return dateStr || '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function formatLongDateBR(dateStr) {
  if (!isValidDate(dateStr)) return dateStr || '';
  const weekday = WEEKDAYS[weekdayOf(dateStr)];
  return `${weekday}, ${formatDateBR(dateStr)}`;
}

export function isValidStatus(status) {
  return ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(status);
}

/** Statuses que ocupam um horario na agenda. */
export const ACTIVE_STATUSES = ['pending', 'confirmed', 'completed'];

/** Verifica se dois intervalos [aStart,aEnd) e [bStart,bEnd) se sobrepoem. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
