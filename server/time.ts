// Utilitarios de data/hora. Todas as datas sao tratadas como texto "YYYY-MM-DD"
// e todos os horarios como texto "HH:MM", sempre no fuso configurado (padrao America/Fortaleza).

import type { AppointmentStatus } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoDate: string;
}

export function appTimeZone(): string {
  return process.env.TZ || 'America/Fortaleza';
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

function dateTimeParts(date: Date, timeZone: string = appTimeZone()): DateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  const yearStr = parts['year'] ?? '1970';
  const monthStr = parts['month'] ?? '01';
  const dayStr = parts['day'] ?? '01';
  const hourStr = parts['hour'] ?? '00';
  const minuteStr = parts['minute'] ?? '00';

  return {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: Number(hourStr === '24' ? 0 : hourStr),
    minute: Number(minuteStr),
    isoDate: `${yearStr}-${monthStr}-${dayStr}`,
  };
}

export const WEEKDAYS: readonly string[] = [
  'Domingo',
  'Segunda-feira',
  'Terca-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sabado',
];

export const WEEKDAYS_SHORT: readonly string[] = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

export function isValidDate(value: unknown): value is string {
  const str = String(value ?? '');
  if (!DATE_RE.test(str)) return false;
  const parsed = new Date(`${str}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === str;
}

export function isValidTime(value: unknown): value is string {
  return TIME_RE.test(String(value ?? ''));
}

export function hhmmToMinutes(value: unknown): number {
  const match = TIME_RE.exec(String(value ?? ''));
  if (!match) return NaN;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

export function minutesToHHMM(minutes: number): string {
  const total = Math.round(Number(minutes));
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Converte um objeto Date para "YYYY-MM-DD" no fuso configurado. */
export function toISODate(date: Date, timeZone: string = appTimeZone()): string {
  return dateTimeParts(date, timeZone).isoDate;
}

export function todayISO(now: Date = new Date(), timeZone: string = appTimeZone()): string {
  return toISODate(now, timeZone);
}

export function nowMinutes(now: Date = new Date(), timeZone: string = appTimeZone()): number {
  const { hour, minute } = dateTimeParts(now, timeZone);
  return hour * 60 + minute;
}

export function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

/** 0 = domingo ... 6 = sabado */
export function weekdayOf(dateStr: string): number {
  return parseDate(dateStr).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const base = parseDate(dateStr);
  base.setUTCDate(base.getUTCDate() + Number(days));
  return base.toISOString().slice(0, 10);
}

/** Retorna a segunda-feira da semana da data informada. */
export function startOfWeek(dateStr: string): string {
  const weekday = weekdayOf(dateStr);
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return addDays(dateStr, diff);
}

export function endOfWeek(dateStr: string): string {
  return addDays(startOfWeek(dateStr), 6);
}

export function formatDateBR(dateStr: string | null | undefined): string {
  if (!dateStr || !isValidDate(dateStr)) return dateStr || '';
  const [y = '', m = '', d = ''] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function formatLongDateBR(dateStr: string | null | undefined): string {
  if (!dateStr || !isValidDate(dateStr)) return dateStr || '';
  const weekday = WEEKDAYS[weekdayOf(dateStr)] ?? '';
  return `${weekday}, ${formatDateBR(dateStr)}`;
}

const VALID_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
];

export function isValidStatus(status: unknown): status is AppointmentStatus {
  return typeof status === 'string' && (VALID_STATUSES as readonly string[]).includes(status);
}

/** Statuses que ocupam um horario na agenda. */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['pending', 'confirmed', 'completed'];

/** Verifica se dois intervalos [aStart,aEnd) e [bStart,bEnd) se sobrepoem. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
