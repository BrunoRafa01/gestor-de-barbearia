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
  hhmmToMinutes,
  minutesToHHMM,
  nowMinutes,
  overlaps,
  todayISO,
  weekdayOf,
} from './time.js';

const ACTIVE_SQL = ACTIVE_STATUSES.map((status) => `'${status}'`).join(',');

/* --------------------------- Cache de configuracao ------------------------- */

let businessHoursCache = null;
let closuresCache = null;
const barberHoursCache = new Map();

export function invalidateBusinessHours() {
  businessHoursCache = null;
}

export function invalidateBarberHours(barberId = null) {
  if (barberId === null || barberId === undefined) barberHoursCache.clear();
  else barberHoursCache.delete(Number(barberId));
}

export function invalidateClosures() {
  closuresCache = null;
}

export function invalidateAvailabilityCaches() {
  businessHoursCache = null;
  closuresCache = null;
  barberHoursCache.clear();
}

async function businessHours() {
  if (!businessHoursCache) {
    const rows = await all('SELECT * FROM business_hours ORDER BY weekday', []);
    businessHoursCache = new Map(rows.map((row) => [Number(row.weekday), row]));
  }
  return businessHoursCache;
}

async function barberHours(barberId) {
  const key = Number(barberId);
  if (!barberHoursCache.has(key)) {
    const rows = await all(
      'SELECT * FROM barber_hours WHERE barber_id = ? ORDER BY weekday',
      [key]
    );
    barberHoursCache.set(key, new Map(rows.map((row) => [Number(row.weekday), row])));
  }
  return barberHoursCache.get(key);
}

async function closures() {
  if (!closuresCache) {
    const rows = await all('SELECT date, reason FROM closures', []);
    closuresCache = new Map(rows.map((row) => [row.date, row]));
  }
  return closuresCache;
}

/* ------------------------------ Leituras publicas -------------------------- */

export function getBusinessHours() {
  return businessHours();
}

export function getBarberHours(barberId) {
  return barberHours(barberId);
}

export async function getClosure(date) {
  return (await closures()).get(date) || null;
}

export async function listClosures() {
  return [...(await closures()).values()];
}

/* ------------------------------- Calculo puro ------------------------------ */

/**
 * Janelas de atendimento (em minutos) para um dia, dadas as configuracoes.
 * Ordem das verificacoes mantida igual a original (mensagens de erro estaveis).
 */
function windowsFor(date, business, barberDay, closure) {
  if (!business || !Number(business.is_open)) {
    return { windows: [], reason: 'A barbearia nao abre neste dia.' };
  }

  if (closure) {
    return { windows: [], reason: closure.reason ? `Fechado: ${closure.reason}` : 'Dia fechado.' };
  }

  if (!barberDay || !Number(barberDay.is_working)) {
    return { windows: [], reason: 'O profissional nao atende neste dia.' };
  }

  const start = Math.max(
    hhmmToMinutes(business.open_time),
    hhmmToMinutes(barberDay.start_time)
  );
  const end = Math.min(
    hhmmToMinutes(business.close_time),
    hhmmToMinutes(barberDay.end_time)
  );

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return { windows: [], reason: 'Sem horario de atendimento neste dia.' };
  }

  const breaks = [];
  if (business.break_start && business.break_end) {
    breaks.push([hhmmToMinutes(business.break_start), hhmmToMinutes(business.break_end)]);
  }
  if (barberDay.break_start && barberDay.break_end) {
    breaks.push([hhmmToMinutes(barberDay.break_start), hhmmToMinutes(barberDay.break_end)]);
  }

  const relevantBreaks = breaks
    .filter(([bs, be]) => Number.isFinite(bs) && Number.isFinite(be) && bs < end && be > start)
    .sort((a, b) => a[0] - b[0]);

  const windows = [];
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
export async function dayWindows(barberId, date) {
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
async function bookedByDate({ barberId, from, to, excludeId = null }) {
  const params = [Number(barberId), from, to];
  let sql = `SELECT id, date, start_time, end_time FROM appointments
             WHERE barber_id = ? AND date >= ? AND date <= ? AND status IN (${ACTIVE_SQL})`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(Number(excludeId));
  }

  const map = new Map();
  for (const row of await all(sql, params)) {
    const list = map.get(row.date) || [];
    list.push({
      id: Number(row.id),
      start: hhmmToMinutes(row.start_time),
      end: hhmmToMinutes(row.end_time),
    });
    map.set(row.date, list);
  }
  return map;
}

/* --------------------------- Calculo de disponibilidade -------------------- */

/**
 * Calcula a disponibilidade de varias datas de uma vez, usando apenas
 * 3 consultas ao banco (servico, jornada e agendamentos do intervalo).
 * @returns {Promise<Map<string, {open:boolean, slots:string[], reason:string|null, duration:number, price:number}>>}
 */
export async function computeAvailabilityRange({
  barberId,
  serviceId,
  dates,
  excludeId = null,
  now = new Date(),
}) {
  const results = new Map();
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

  const duration = Number(service.duration_min);
  const price = Number(service.price);
  const step = Math.max(5, Number(getSetting('slot_interval', '15')) || 15);
  const minAdvance = Math.max(0, Number(getSetting('min_advance_minutes', '0')) || 0);
  const today = todayISO(now);
  const threshold = nowMinutes(now) + minAdvance;

  const sorted = [...dates].sort();
  const [business, barberDays, closureMap] = await Promise.all([
    businessHours(),
    barberHours(barberId),
    closures(),
  ]);

  const booked = barberId
    ? await bookedByDate({ barberId, from: sorted[0], to: sorted[sorted.length - 1], excludeId })
    : new Map();

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

    const taken = booked.get(date) || [];
    const isToday = date === today;
    const slots = [];

    for (const [windowStart, windowEnd] of windows) {
      for (let start = windowStart; start + duration <= windowEnd; start += step) {
        if (isToday && start < threshold) continue;
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
}) {
  const map = await computeAvailabilityRange({
    barberId,
    serviceId,
    dates: [date],
    excludeId,
    now,
  });
  return map.get(date);
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
}) {
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

export function endTimeFor(startTime, durationMin) {
  return minutesToHHMM(hhmmToMinutes(startTime) + Number(durationMin));
}
