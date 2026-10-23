// Relatorios gerenciais por periodo: faturamento, ocupacao, ranking de
// profissionais e servicos, serie diaria e indicadores de clientes.

import { all } from '../db.js';
import { HttpError } from '../http.js';
import { isValidDate, todayISO, weekdayOf } from '../time.js';
import { optionalId } from '../validate.js';

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
const MAX_RANGE_DAYS = 400;

function firstDayOfMonth(date) {
  return `${date.slice(0, 7)}-01`;
}

function diffDays(from, to) {
  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();
  return Math.round((end - start) / 86400000);
}

function resolveRange(query) {
  const today = todayISO();
  const from = isValidDate(query.from) ? query.from : firstDayOfMonth(today);
  const to = isValidDate(query.to) ? query.to : today;
  if (from > to) throw new HttpError(400, 'A data inicial deve ser anterior a final.');
  if (diffDays(from, to) > MAX_RANGE_DAYS) {
    throw new HttpError(400, `O periodo do relatorio deve ter no maximo ${MAX_RANGE_DAYS} dias.`);
  }
  return { from, to };
}

/** Divisao segura (evita NaN/Infinity nos indicadores). */
function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(2)) : 0;
}

export const reportRoutes = [
  {
    method: 'GET',
    path: '/api/reports',
    handler: async ({ query }) => {
      const { from, to } = resolveRange(query);
      const barberId = optionalId(query.barber_id, 'profissional');

      const barberFilter = barberId ? ' AND a.barber_id = ?' : '';
      const barberParams = barberId ? [barberId] : [];

      const [statusRows, barberRows, serviceRows, dailyRows, newClients] = await Promise.all([
        all(
          `SELECT status, COUNT(*) AS total, COALESCE(SUM(price), 0) AS revenue
             FROM appointments a
            WHERE a.date BETWEEN ? AND ?${barberFilter}
            GROUP BY status`,
          [from, to, ...barberParams]
        ),
        all(
          `SELECT b.id AS barber_id, b.name AS name, b.commission AS commission,
                  COUNT(*) AS total,
                  COALESCE(SUM(a.price), 0) AS revenue,
                  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price ELSE 0 END), 0) AS realized,
                  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed
             FROM appointments a JOIN barbers b ON b.id = a.barber_id
            WHERE a.date BETWEEN ? AND ? AND a.status != 'cancelled'${barberFilter}
            GROUP BY a.barber_id
            ORDER BY revenue DESC`,
          [from, to, ...barberParams]
        ),
        all(
          `SELECT s.id AS service_id, s.name AS name, COUNT(*) AS total,
                  COALESCE(SUM(a.price), 0) AS revenue
             FROM appointments a JOIN services s ON s.id = a.service_id
            WHERE a.date BETWEEN ? AND ? AND a.status != 'cancelled'${barberFilter}
            GROUP BY a.service_id
            ORDER BY total DESC`,
          [from, to, ...barberParams]
        ),
        all(
          `SELECT a.date AS date,
                  COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
                  COALESCE(SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END), 0) AS no_show,
                  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
                  COALESCE(SUM(CASE WHEN a.status != 'cancelled' THEN a.price ELSE 0 END), 0) AS revenue
             FROM appointments a
            WHERE a.date BETWEEN ? AND ?${barberFilter}
            GROUP BY a.date
            ORDER BY a.date ASC`,
          [from, to, ...barberParams]
        ),
        all(
          `SELECT COUNT(*) AS total FROM clients WHERE date(created_at) BETWEEN ? AND ?`,
          [from, to]
        ),
      ]);

      const statusMap = new Map(
        statusRows.map((row) => [
          row.status,
          { total: Number(row.total), revenue: Number(row.revenue || 0) },
        ])
      );
      const statusCount = (status) => statusMap.get(status)?.total || 0;

      const totalAppointments = statusRows.reduce((sum, row) => sum + Number(row.total), 0);
      const cancelled = statusCount('cancelled');
      const completed = statusCount('completed');
      const noShow = statusCount('no_show');
      const revenueExpected = statusRows
        .filter((row) => row.status !== 'cancelled')
        .reduce((sum, row) => sum + Number(row.revenue || 0), 0);
      const revenueRealized = statusMap.get('completed')?.revenue || 0;

      const daily = dailyRows.map((row) => ({
        date: row.date,
        weekday: WEEKDAY_LABELS[weekdayOf(row.date)],
        total: Number(row.total),
        completed: Number(row.completed),
        cancelled: Number(row.cancelled),
        no_show: Number(row.no_show),
        revenue: Number(row.revenue || 0),
      }));

      const byWeekday = WEEKDAY_LABELS.map((label, index) => {
        const rows = daily.filter((row) => weekdayOf(row.date) === index);
        return {
          weekday: index,
          label,
          total: rows.reduce((sum, row) => sum + row.total, 0),
          revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
        };
      });

      const activeDays = daily.length;

      return {
        status: 200,
        body: {
          range: { from, to, days: diffDays(from, to) + 1, active_days: activeDays },
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
            revenue_per_active_day: activeDays
              ? Number((revenueRealized / activeDays).toFixed(2))
              : 0,
            new_clients: Number(newClients?.[0]?.total || 0),
          },
          by_status: statusRows.map((row) => ({
            status: row.status,
            total: Number(row.total),
            revenue: Number(row.revenue || 0),
          })),
          by_barber: barberRows.map((row) => ({
            barber_id: Number(row.barber_id),
            name: row.name,
            total: Number(row.total),
            completed: Number(row.completed),
            revenue: Number(row.revenue || 0),
            realized: Number(row.realized || 0),
            commission_percent: Number(row.commission || 0),
            commission_value: Number(
              ((Number(row.realized || 0) * Number(row.commission || 0)) / 100).toFixed(2)
            ),
          })),
          by_service: serviceRows.map((row) => ({
            service_id: Number(row.service_id),
            name: row.name,
            total: Number(row.total),
            revenue: Number(row.revenue || 0),
          })),
          by_weekday: byWeekday,
          daily,
          filter: { barber_id: barberId, from, to },
        },
      };
    },
  },
];
