// Regras de negocio e consultas de relatorios gerenciais por periodo.

import { dayWindows } from './availability.js';
import { all } from './db.js';
import { HttpError } from './http.js';
import { addDays, hhmmToMinutes, isValidDate, todayISO, weekdayOf } from './time.js';
import { optionalId } from './validate.js';

const WEEKDAY_LABELS: readonly string[] = [
  'Domingo',
  'Segunda',
  'Terca',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sabado',
];
const MAX_RANGE_DAYS = 400;

export interface DateRange {
  from: string;
  to: string;
}

export interface DailyReportRow {
  date: string;
  weekday: string;
  total: number;
  completed: number;
  cancelled: number;
  no_show: number;
  revenue: number;
  revenue_realized: number;
  revenue_expected: number;
}

export interface WeekdayReportRow {
  weekday: number;
  label: string;
  total: number;
  revenue: number;
  revenue_expected: number;
}

export interface BarberReportRow {
  barber_id: number;
  name: string;
  total: number;
  total_appointments: number;
  completed: number;
  revenue: number;
  realized: number;
  commission_percent: number;
  commission_value: number;
}

export interface ServiceReportRow {
  service_id: number;
  name: string;
  total: number;
  revenue: number;
}

export interface StatusReportRow {
  status: string;
  total: number;
  revenue: number;
}

export interface ReportResult {
  range: { from: string; to: string; days: number; active_days: number };
  generated_at: string;
  totals: {
    appointments: number;
    completed: number;
    cancelled: number;
    no_show: number;
    pending: number;
    confirmed: number;
    revenue_realized: number;
    revenue_expected: number;
    average_ticket: number;
    cancellation_rate: number;
    no_show_rate: number;
    completion_rate: number;
    revenue_per_active_day: number;
    new_clients: number;
    returning_clients: number;
    repeat_rate: number;
    occupancy_rate: number | null;
  };
  occupancy: {
    available_minutes: number;
    booked_minutes: number;
    rate: number | null;
  };
  comparison: {
    previous_from: string;
    previous_to: string;
    previous_appointments: number;
    previous_revenue_realized: number;
    revenue_growth_pct: number;
  };
  by_status: StatusReportRow[];
  by_barber: BarberReportRow[];
  by_service: ServiceReportRow[];
  by_weekday: WeekdayReportRow[];
  daily: DailyReportRow[];
  filter: { barber_id: number | null; from: string; to: string };
}

function firstDayOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function diffDays(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();
  return Math.round((end - start) / 86400000);
}

export function resolveRange(query: Record<string, unknown> = {}): DateRange {
  const today = todayISO();
  const from = isValidDate(query['from']) ? query['from'] : firstDayOfMonth(today);
  const to = isValidDate(query['to']) ? query['to'] : today;
  if (from > to) throw new HttpError(400, 'A data inicial deve ser anterior a final.');
  if (diffDays(from, to) > MAX_RANGE_DAYS) {
    throw new HttpError(400, `O periodo do relatorio deve ter no maximo ${MAX_RANGE_DAYS} dias.`);
  }
  return { from, to };
}

/** Divisao segura (evita NaN/Infinity nos indicadores). */
export function ratio(part: number, total: number): number {
  return total > 0 ? Number((part / total).toFixed(2)) : 0;
}

export async function buildReport(
  query: Record<string, unknown> = {},
  shopId: number = 1
): Promise<ReportResult> {
  const { from, to } = resolveRange(query);
  const barberId = optionalId(query['barber_id'], 'profissional');
  const sid = Number(shopId) || 1;

  const barberFilter = barberId ? ' AND a.barber_id = ?' : '';
  const barberParams: number[] = barberId ? [barberId] : [];

  const rangeDays = diffDays(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(rangeDays - 1));

  const [
    statusRows,
    barberRows,
    serviceRows,
    dailyRows,
    newClients,
    prevRows,
    repeatRows,
    activeBarbers,
    bookedRows,
  ] = await Promise.all([
    all(
      `SELECT status, COUNT(*) AS total, COALESCE(SUM(price), 0) AS revenue
         FROM appointments a
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ?${barberFilter}
        GROUP BY status`,
      [sid, from, to, ...barberParams]
    ),
    all(
      `SELECT b.id AS barber_id, b.name AS name, b.commission AS commission,
              COUNT(*) AS total_appointments,
              COALESCE(SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END), 0) AS total,
              COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price ELSE 0 END), 0) AS realized,
              COALESCE(SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed
         FROM appointments a JOIN barbers b ON b.id = a.barber_id
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ?${barberFilter}
        GROUP BY a.barber_id
        ORDER BY revenue DESC, completed DESC, total_appointments DESC`,
      [sid, from, to, ...barberParams]
    ),
    all(
      `SELECT a.service_id AS service_id, COALESCE(s.name, 'Serviço removido') AS name, COUNT(*) AS total,
              COALESCE(SUM(a.price), 0) AS revenue
         FROM appointments a LEFT JOIN services s ON s.id = a.service_id
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ? AND a.status = 'completed'${barberFilter}
        GROUP BY a.service_id
        ORDER BY total DESC, revenue DESC`,
      [sid, from, to, ...barberParams]
    ),
    all(
      `SELECT a.date AS date,
              COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
              COALESCE(SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END), 0) AS no_show,
              COALESCE(SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
              COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN a.status IN ('pending', 'confirmed', 'completed') THEN a.price ELSE 0 END), 0) AS revenue_expected
         FROM appointments a
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ?${barberFilter}
        GROUP BY a.date
        ORDER BY a.date ASC`,
      [sid, from, to, ...barberParams]
    ),
    all(
      `SELECT COUNT(*) AS total FROM clients WHERE shop_id = ? AND date(created_at) BETWEEN ? AND ?`,
      [sid, from, to]
    ),
    all(
      `SELECT COUNT(*) AS appointments,
              COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price ELSE 0 END), 0) AS revenue_realized
         FROM appointments a
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ?${barberFilter}`,
      [sid, prevFrom, prevTo, ...barberParams]
    ),
    all(
      `SELECT COUNT(DISTINCT a.client_id) AS unique_clients,
              COUNT(DISTINCT CASE
                WHEN EXISTS (
                  SELECT 1 FROM appointments p
                   WHERE p.shop_id = ? AND p.client_id = a.client_id AND p.status = 'completed' AND p.date < ?
                ) THEN a.client_id
              END) AS returning_clients
         FROM appointments a
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ? AND a.status = 'completed'${barberFilter}`,
      [sid, from, sid, from, to, ...barberParams]
    ),
    all(
      barberId
        ? 'SELECT id FROM barbers WHERE shop_id = ? AND id = ? AND active = 1'
        : 'SELECT id FROM barbers WHERE shop_id = ? AND active = 1',
      barberId ? [sid, barberId] : [sid]
    ),
    all(
      `SELECT a.start_time, a.end_time
         FROM appointments a
        WHERE a.shop_id = ? AND a.date BETWEEN ? AND ? AND a.status IN ('pending', 'confirmed', 'completed')${barberFilter}`,
      [sid, from, to, ...barberParams]
    ),
  ]);

  let availableMinutes = 0;
  for (let offset = 0; offset < rangeDays; offset += 1) {
    const dayIso = addDays(from, offset);
    for (const barber of activeBarbers) {
      const { windows } = await dayWindows(Number(barber['id']), dayIso);
      for (const [start, end] of windows) availableMinutes += end - start;
    }
  }
  const bookedMinutes = bookedRows.reduce((sum, row) => {
    const start = hhmmToMinutes(row['start_time']);
    const end = hhmmToMinutes(row['end_time']);
    return Number.isFinite(start) && Number.isFinite(end) ? sum + Math.max(0, end - start) : sum;
  }, 0);
  const occupancyRate =
    availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : null;

  const statusMap = new Map<string, { total: number; revenue: number }>(
    statusRows.map((row) => [
      String(row['status'] ?? ''),
      { total: Number(row['total'] || 0), revenue: Number(row['revenue'] || 0) },
    ])
  );
  const statusCount = (status: string): number => statusMap.get(status)?.total || 0;

  const totalAppointments = statusRows.reduce((sum, row) => sum + Number(row['total'] || 0), 0);
  const cancelled = statusCount('cancelled');
  const completed = statusCount('completed');
  const noShow = statusCount('no_show');
  const revenueExpected = statusRows
    .filter((row) => ['pending', 'confirmed', 'completed'].includes(String(row['status'] ?? '')))
    .reduce((sum, row) => sum + Number(row['revenue'] || 0), 0);
  const revenueRealized = statusMap.get('completed')?.revenue || 0;

  const daily: DailyReportRow[] = dailyRows.map((row) => {
    const dateStr = String(row['date'] ?? '');
    return {
      date: dateStr,
      weekday: WEEKDAY_LABELS[weekdayOf(dateStr)] ?? '',
      total: Number(row['total'] || 0),
      completed: Number(row['completed'] || 0),
      cancelled: Number(row['cancelled'] || 0),
      no_show: Number(row['no_show'] || 0),
      revenue: Number(row['revenue'] || 0),
      revenue_realized: Number(row['revenue'] || 0),
      revenue_expected: Number(row['revenue_expected'] || 0),
    };
  });

  const byWeekday: WeekdayReportRow[] = WEEKDAY_LABELS.map((label, index) => {
    const rows = daily.filter((row) => weekdayOf(row.date) === index);
    return {
      weekday: index,
      label,
      total: rows.reduce((sum, row) => sum + row.total, 0),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      revenue_expected: rows.reduce((sum, row) => sum + row.revenue_expected, 0),
    };
  });

  const activeDays = daily.length;

  const prevRealized = Number(prevRows[0]?.['revenue_realized'] || 0);
  const prevAppointments = Number(prevRows[0]?.['appointments'] || 0);
  const uniqueClients = Number(repeatRows[0]?.['unique_clients'] || 0);
  const returningClients = Number(repeatRows[0]?.['returning_clients'] || 0);
  const revenueGrowthPct =
    prevRealized > 0
      ? Number((((revenueRealized - prevRealized) / prevRealized) * 100).toFixed(1))
      : revenueRealized > 0
        ? 100
        : 0;

  return {
    range: { from, to, days: rangeDays, active_days: activeDays },
    generated_at: new Date().toISOString(),
    totals: {
      appointments: totalAppointments,
      completed,
      cancelled,
      no_show: noShow,
      pending: statusCount('pending'),
      confirmed: statusCount('confirmed'),
      revenue_realized: revenueRealized,
      revenue_expected: revenueExpected,
      average_ticket: completed ? Number((revenueRealized / completed).toFixed(2)) : 0,
      cancellation_rate: ratio(cancelled, totalAppointments),
      no_show_rate: ratio(noShow, totalAppointments),
      completion_rate: ratio(completed, totalAppointments),
      revenue_per_active_day: activeDays ? Number((revenueRealized / activeDays).toFixed(2)) : 0,
      new_clients: Number(newClients[0]?.['total'] || 0),
      returning_clients: returningClients,
      repeat_rate: ratio(returningClients, uniqueClients),
      occupancy_rate: occupancyRate,
    },
    occupancy: {
      available_minutes: availableMinutes,
      booked_minutes: bookedMinutes,
      rate: occupancyRate,
    },
    comparison: {
      previous_from: prevFrom,
      previous_to: prevTo,
      previous_appointments: prevAppointments,
      previous_revenue_realized: prevRealized,
      revenue_growth_pct: revenueGrowthPct,
    },
    by_status: statusRows.map((row) => ({
      status: String(row['status'] ?? ''),
      total: Number(row['total'] || 0),
      revenue: Number(row['revenue'] || 0),
    })),
    by_barber: barberRows
      .filter((row) => Number(row['completed']) > 0)
      .map((row) => {
        const realized = Number(row['realized'] || 0);
        const commission = Number(row['commission'] || 0);
        return {
          barber_id: Number(row['barber_id']),
          name: String(row['name'] ?? ''),
          total: Number(row['total'] || 0),
          total_appointments: Number(row['total_appointments'] || row['total'] || 0),
          completed: Number(row['completed'] || 0),
          revenue: Number(row['revenue'] || 0),
          realized,
          commission_percent: commission,
          commission_value: Number(((realized * commission) / 100).toFixed(2)),
        };
      }),
    by_service: serviceRows.map((row) => ({
      service_id: Number(row['service_id'] || 0),
      name: String(row['name'] ?? ''),
      total: Number(row['total'] || 0),
      revenue: Number(row['revenue'] || 0),
    })),
    by_weekday: byWeekday,
    daily,
    filter: { barber_id: barberId, from, to },
  };
}
