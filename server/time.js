// Utilitarios de data/hora. Todas as datas sao tratadas como texto "YYYY-MM-DD"
// e todos os horarios como texto "HH:MM", sempre no fuso configurado (padrao America/Sao_Paulo).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function appTimeZone() {
  return process.env.TZ || 'America/Sao_Paulo';
}

function dateTimeParts(date, timeZone = appTimeZone()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? 0 : parts.hour),
    minute: Number(parts.minute),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

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
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

/** Converte um objeto Date para "YYYY-MM-DD" no fuso configurado (America/Sao_Paulo). */
export function toISODate(date) {
  return dateTimeParts(date).isoDate;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function nowMinutes(now = new Date()) {
  const { hour, minute } = dateTimeParts(now);
  return hour * 60 + minute;
}

export function parseDate(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`);
}

/** 0 = domingo ... 6 = sabado */
export function weekdayOf(dateStr) {
  return parseDate(dateStr).getUTCDay();
}

export function addDays(dateStr, days) {
  const base = parseDate(dateStr);
  base.setUTCDate(base.getUTCDate() + Number(days));
  return base.toISOString().slice(0, 10);
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
