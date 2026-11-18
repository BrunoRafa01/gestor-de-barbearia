// Regras de disponibilidade: dias de funcionamento, folgas, jornada do barbeiro
// e controle de conflitos/agendamentos duplicados.
//
// Os dados de configuracao (funcionamento, jornada e folgas) mudam pouco, mas sao
// lidos em toda consulta de agenda. Por isso ficam em cache na memoria e sao
// invalidados explicitamente pelas rotas que os alteram. Isso mantem a agenda
// rapida mesmo com o banco remoto (Turso) em producao.

import { all, get, getSetting } from './db.js';
import { HttpError } from './http.js';
import {
  ACTIVE_STATUSES,
  addDays,
  hhmmToMinutes,
  minutesToHHMM,
  nowMinutes,
  overlaps,
  todayISO,
  weekdayOf,
} from './time.js';
import type { BarberHours, BusinessHours } from './types.js';

const ACTIVE_SQL = ACTIVE_STATUSES.map((status) => `'${status}'`).join(',');

export type TimeWindow = [number, number];

export interface ClosureEntry {
  date: string;
  reason: string | null;
}

export interface DayWindowsResult {
  windows: TimeWindow[];
  reason: string | null;
}

export interface AvailabilityResult {
  open: boolean;
  slots: string[];
  reason: string | null;
  duration: number;
  price: number;
}

export interface ComputeAvailabilityRangeOptions {
  barberId: number;
  serviceId: number;
  dates: readonly string[];
  excludeId?: number | null;
  now?: Date;
}

export interface ComputeAvailabilityOptions {
  barberId: number;
  serviceId: number;
  date: string;
  excludeId?: number | null;
  now?: Date;
}

export interface AssertSlotAvailableOptions extends ComputeAvailabilityOptions {
  startTime: string;
}

interface BookedInterval {
  id: number;
  start: number;
  end: number;
  block?: boolean;
}

/* --------------------------- Cache de configuracao ------------------------- */

let businessHoursCache: Map<number, BusinessHours> | null = null;
let closuresCache: Map<string, ClosureEntry> | null = null;
const barberHoursCache = new Map<number, Map<number, BarberHours>>();

export function invalidateBusinessHours(): void {
  businessHoursCache = null;
}

export function invalidateBarberHours(barberId: number | null = null): void {
  if (barberId === null || barberId === undefined) barberHoursCache.clear();
  else barberHoursCache.delete(Number(barberId));
}

export function invalidateClosures(): void {
  closuresCache = null;
}

export function invalidateAvailabilityCaches(): void {
  businessHoursCache = null;
  closuresCache = null;
  barberHoursCache.clear();
}

function mapBusinessHourRow(row: Record<string, unknown>): BusinessHours {
  return {
    weekday: Number(row['weekday'] ?? 0),
    is_open: Number(row['is_open'] ?? 0),
    open_time: String(row['open_time'] ?? '09:00'),
    close_time: String(row['close_time'] ?? '19:00'),
    break_start: row['break_start'] ? String(row['break_start']) : null,
    break_end: row['break_end'] ? String(row['break_end']) : null,
  };
}

function mapBarberHourRow(row: Record<string, unknown>): BarberHours {
  return {
    id: row['id'] !== undefined ? Number(row['id']) : undefined,
    barber_id: Number(row['barber_id'] ?? 0),
    weekday: Number(row['weekday'] ?? 0),
    is_working: Number(row['is_working'] ?? 0),
    start_time: String(row['start_time'] ?? '09:00'),
    end_time: String(row['end_time'] ?? '19:00'),
    break_start: row['break_start'] ? String(row['break_start']) : null,
    break_end: row['break_end'] ? String(row['break_end']) : null,
  };
}

async function businessHours(): Promise<Map<number, BusinessHours>> {
  if (!businessHoursCache) {
    const rows = await all('SELECT * FROM business_hours ORDER BY weekday', []);
    businessHoursCache = new Map(
      rows.map((row) => {
        const mapped = mapBusinessHourRow(row);
        return [mapped.weekday, mapped];
      })
    );
  }
  return businessHoursCache;
}

async function barberHours(barberId: number): Promise<Map<number, BarberHours>> {
  const key = Number(barberId);
  const cached = barberHoursCache.get(key);
  if (cached) return cached;

  const rows = await all('SELECT * FROM barber_hours WHERE barber_id = ? ORDER BY weekday', [key]);
  const map = new Map(
    rows.map((row) => {
      const mapped = mapBarberHourRow(row);
      return [mapped.weekday, mapped];
    })
  );
  barberHoursCache.set(key, map);
  return map;
}

async function closures(): Promise<Map<string, ClosureEntry>> {
  if (!closuresCache) {
    const rows = await all('SELECT date, reason FROM closures', []);
    closuresCache = new Map(
      rows.map((row) => {
        const date = String(row['date'] ?? '');
        return [date, { date, reason: row['reason'] ? String(row['reason']) : null }];
      })
    );
  }
  return closuresCache;
}

/* ------------------------------ Leituras publicas -------------------------- */

export function getBusinessHours(): Promise<Map<number, BusinessHours>> {
  return businessHours();
}

export function getBarberHours(barberId: number): Promise<Map<number, BarberHours>> {
  return barberHours(barberId);
}

export async function getClosure(date: string): Promise<ClosureEntry | null> {
  return (await closures()).get(date) || null;
}

export async function listClosures(): Promise<ClosureEntry[]> {
  return [...(await closures()).values()];
}

/* ------------------------------- Calculo puro ------------------------------ */

/**
 * Janelas de atendimento (em minutos) para um dia, dadas as configuracoes.
 * Ordem das verificacoes mantida igual a original (mensagens de erro estaveis).
 */
function windowsFor(
  _date: string,
  business: BusinessHours | undefined,
  barberDay: BarberHours | undefined,
  closure: ClosureEntry | undefined
): DayWindowsResult {
  if (!business || !Number(business.is_open)) {
    return { windows: [], reason: 'A barbearia nao abre neste dia.' };
  }

  if (closure) {
    return { windows: [], reason: closure.reason ? `Fechado: ${closure.reason}` : 'Dia fechado.' };
  }

  if (!barberDay || !Number(barberDay.is_working)) {
    return { windows: [], reason: 'O profissional nao atende neste dia.' };
  }

  const start = Math.max(hhmmToMinutes(business.open_time), hhmmToMinutes(barberDay.start_time));
  const end = Math.min(hhmmToMinutes(business.close_time), hhmmToMinutes(barberDay.end_time));

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return { windows: [], reason: 'Sem horario de atendimento neste dia.' };
  }

  const breaks: TimeWindow[] = [];
  if (business.break_start && business.break_end) {
    breaks.push([hhmmToMinutes(business.break_start), hhmmToMinutes(business.break_end)]);
  }
  if (barberDay.break_start && barberDay.break_end) {
    breaks.push([hhmmToMinutes(barberDay.break_start), hhmmToMinutes(barberDay.break_end)]);
  }

  const relevantBreaks = breaks
    .filter(([bs, be]) => Number.isFinite(bs) && Number.isFinite(be) && bs < end && be > start)
    .sort((a, b) => a[0] - b[0]);

  const windows: TimeWindow[] = [];
  let cursor = start;
  for (const [breakStart, breakEnd] of relevantBreaks) {
    if (breakStart > cursor) windows.push([cursor, Math.min(breakStart, end)]);
    cursor = Math.max(cursor, breakEnd);
  }
  if (cursor < end) windows.push([cursor, end]);

  return { windows: windows.filter(([ws, we]) => we - ws > 0), reason: null };
}

/* --------------------------- Janelas de atendimento ------------------------ */

/** Janelas de atendimento (em minutos) para um barbeiro em uma data. */
export async function dayWindows(barberId: number, date: string): Promise<DayWindowsResult> {
  const weekday = weekdayOf(date);
  const [business, barberDays, closureMap] = await Promise.all([
    businessHours(),
    barberHours(barberId),
    closures(),
  ]);
  return windowsFor(date, business.get(weekday), barberDays.get(weekday), closureMap.get(date));
}

/* ------------------------- Agendamentos que ocupam ------------------------- */

/** Intervalos ja ocupados por agendamentos ativos, agrupados por data. */
async function bookedByDate({
  barberId,
  from,
  to,
  excludeId = null,
}: {
  barberId: number;
  from: string;
  to: string;
  excludeId?: number | null;
}): Promise<Map<string, BookedInterval[]>> {
  const params: Array<number | string> = [Number(barberId), from, to];
  let sql = `SELECT id, date, start_time, end_time FROM appointments
             WHERE barber_id = ? AND date >= ? AND date <= ? AND status IN (${ACTIVE_SQL})`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(Number(excludeId));
  }

  const map = new Map<string, BookedInterval[]>();
  for (const row of await all(sql, params)) {
    const dateKey = String(row['date'] ?? '');
    const list = map.get(dateKey) || [];
    list.push({
      id: Number(row['id']),
      start: hhmmToMinutes(row['start_time']),
      end: hhmmToMinutes(row['end_time']),
    });
    map.set(dateKey, list);
  }

  const blockRows = await all(
    `SELECT id, date, start_time, end_time FROM barber_blocks
      WHERE date >= ? AND date <= ? AND (barber_id = ? OR barber_id IS NULL)`,
    [from, to, Number(barberId)]
  );
  for (const block of blockRows) {
    const dateKey = String(block['date'] ?? '');
    const list = map.get(dateKey) || [];
    list.push({
      id: Number(block['id']),
      start: hhmmToMinutes(block['start_time']),
      end: hhmmToMinutes(block['end_time']),
      block: true,
    });
    map.set(dateKey, list);
  }

  return map;
}

/* --------------------------- Calculo de disponibilidade -------------------- */

/**
 * Calcula a disponibilidade de varias datas de uma vez, usando apenas
 * consultas agregadas ao banco.
 */
export async function computeAvailabilityRange({
  barberId,
  serviceId,
  dates,
  excludeId = null,
  now = new Date(),
}: ComputeAvailabilityRangeOptions): Promise<Map<string, AvailabilityResult>> {
  const results = new Map<string, AvailabilityResult>();
  if (!dates || !dates.length) return results;

  const service = await get('SELECT * FROM services WHERE id = ?', [serviceId]);
  if (!service) {
    for (const date of dates) {
      results.set(date, {
        open: false,
        slots: [],
        reason: 'Servico nao encontrado.',
        duration: 0,
        price: 0,
      });
    }
    return results;
  }

  const duration = Number(service['duration_min']);
  const price = Number(service['price']);
  const step = Math.max(5, Number(getSetting('slot_interval', '15')) || 15);
  const minAdvance = Math.max(0, Number(getSetting('min_advance_minutes', '0')) || 0);
  const today = todayISO(now);
  const totalThresholdMin = nowMinutes(now) + minAdvance;
  const cutoffDate = addDays(today, Math.floor(totalThresholdMin / 1440));
  const cutoffMin = totalThresholdMin % 1440;

  const sorted = [...dates].sort();
  const firstDate = sorted[0] ?? today;
  const lastDate = sorted[sorted.length - 1] ?? firstDate;

  const [business, barberDays, closureMap] = await Promise.all([
    businessHours(),
    barberHours(barberId),
    closures(),
  ]);

  const booked = barberId
    ? await bookedByDate({ barberId, from: firstDate, to: lastDate, excludeId })
    : new Map<string, BookedInterval[]>();

  for (const date of dates) {
    const base = { duration, price };

    if (date < today) {
      results.set(date, { ...base, open: false, slots: [], reason: 'Data no passado.' });
      continue;
    }

    const weekday = weekdayOf(date);
    const { windows, reason } = windowsFor(
      date,
      business.get(weekday),
      barberDays.get(weekday),
      closureMap.get(date)
    );

    if (!windows.length) {
      results.set(date, { ...base, open: false, slots: [], reason });
      continue;
    }

    if (date < cutoffDate) {
      results.set(date, {
        ...base,
        open: false,
        slots: [],
        reason: 'Antecedencia minima nao atingida.',
      });
      continue;
    }

    const taken = booked.get(date) || [];
    const isCutoffDay = date === cutoffDate;
    const slots: string[] = [];

    for (const [windowStart, windowEnd] of windows) {
      for (let start = windowStart; start + duration <= windowEnd; start += step) {
        if (isCutoffDay && start < cutoffMin) continue;
        const end = start + duration;
        if (taken.some((item) => overlaps(start, end, item.start, item.end))) continue;
        slots.push(minutesToHHMM(start));
      }
    }

    results.set(date, { ...base, open: true, slots, reason: null });
  }

  return results;
}

/** Calcula os horarios livres para um servico/barbeiro/data. */
export async function computeAvailability({
  barberId,
  serviceId,
  date,
  excludeId = null,
  now = new Date(),
}: ComputeAvailabilityOptions): Promise<AvailabilityResult> {
  const map = await computeAvailabilityRange({
    barberId,
    serviceId,
    dates: [date],
    excludeId,
    now,
  });
  return (
    map.get(date) ?? {
      open: false,
      slots: [],
      reason: 'Data invalida.',
      duration: 0,
      price: 0,
    }
  );
}

/**
 * Valida um horario antes de gravar. Reutiliza o calculo de disponibilidade,
 * o que ao mesmo tempo impede agendamentos duplicados e conflitos de horario.
 */
export async function assertSlotAvailable({
  barberId,
  serviceId,
  date,
  startTime,
  excludeId = null,
  now = new Date(),
}: AssertSlotAvailableOptions): Promise<AvailabilityResult> {
  const availability = await computeAvailability({ barberId, serviceId, date, excludeId, now });

  if (!availability.open) {
    throw new HttpError(409, availability.reason || 'Horario indisponivel.');
  }

  if (!availability.slots.includes(startTime)) {
    const { windows } = await dayWindows(barberId, date);
    const minute = hhmmToMinutes(startTime);
    const insideWindow = windows.some(
      ([start, end]) => minute >= start && minute + availability.duration <= end
    );
    throw new HttpError(
      409,
      insideWindow
        ? 'Este horario ja esta ocupado. Escolha outro horario livre.'
        : 'Este horario esta fora do periodo de atendimento.'
    );
  }

  return availability;
}

export function endTimeFor(startTime: string, durationMin: number): string {
  return minutesToHHMM(hhmmToMinutes(startTime) + Number(durationMin));
}
