import { listAppointments } from '../appointments.js';
import { dayWindows } from '../availability.js';
import { all, get, getSetting } from '../db.js';
import { decryptSensitiveField } from '../security.js';
import { hhmmToMinutes, startOfWeek, endOfWeek, todayISO, toISODate } from '../time.js';
import type { Appointment, RouteContext, RouteDefinition } from '../types.js';

function sumBy<T extends { price?: number | unknown }>(rows: T[], predicate: (row: T) => boolean): number {
  return rows.filter(predicate).reduce((total, row) => total + Number(row.price || 0), 0);
}

function monthRange(date: string): { start: string; end: string } {
  const parts = date.split('-').map(Number);
  const year = parts[0] ?? 2026;
  const month = parts[1] ?? 1;
  const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const end = toISODate(new Date(Date.UTC(year, month, 0, 12, 0, 0)));
  return { start, end };
}

/** Taxa de ocupacao do dia: minutos disponiveis x minutos agendados. */
async function occupancyFor(date: string, shopId = 1) {
  const barbers = await all('SELECT id FROM barbers WHERE shop_id = ? AND active = 1', [shopId]);
  let availableMinutes = 0;

  for (const barber of barbers) {
    const { windows } = await dayWindows(Number(barber.id), date);
    for (const windowPair of windows) {
      const start = windowPair[0] ?? 0;
      const end = windowPair[1] ?? 0;
      availableMinutes += end - start;
    }
  }

  const appointments = (await listAppointments({ shopId, from: date, to: date })).filter(
    (item): item is Appointment =>
      Boolean(item) && ['pending', 'confirmed', 'completed'].includes(item.status)
  );
  const bookedMinutes = appointments.reduce(
    (total, item) =>
      total + Math.max(0, hhmmToMinutes(item.end_time) - hhmmToMinutes(item.start_time)),
    0
  );

  return {
    barbers: barbers.length,
    available_minutes: availableMinutes,
    booked_minutes: bookedMinutes,
    rate: availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : null,
  };
}

export const dashboardRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/dashboard',
    handler: async ({ query, shopId = 1 }: RouteContext) => {
      const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : todayISO();
      const today = todayISO();

      const dayAppointments = (await listAppointments({ shopId, from: date, to: date }))
        .filter((item): item is Appointment => Boolean(item))
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      const countByStatus = dayAppointments.reduce<Record<string, number>>((acc, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      }, {});

      const weekStart = startOfWeek(date);
      const weekEnd = endOfWeek(date);
      const weekAppointments = (await listAppointments({ shopId, from: weekStart, to: weekEnd })).filter(
        (item): item is Appointment =>
          Boolean(item) && ['pending', 'confirmed', 'completed'].includes(item.status)
      );
      const completedWeek = weekAppointments.filter((item) => item.status === 'completed');

      const { start: monthStart, end: monthEnd } = monthRange(date);
      const monthAppointments = (await listAppointments({ shopId, from: monthStart, to: monthEnd })).filter(
        (item): item is Appointment =>
          Boolean(item) && ['pending', 'confirmed', 'completed'].includes(item.status)
      );
      const completedMonth = monthAppointments.filter((item) => item.status === 'completed');

      const [newClients, totalClientsRow, recentRows] = await Promise.all([
        get(
          'SELECT COUNT(*) AS total FROM clients WHERE shop_id = ? AND date(created_at) BETWEEN ? AND ?',
          [shopId, monthStart, monthEnd]
        ),
        get('SELECT COUNT(*) AS total FROM clients WHERE shop_id = ?', [shopId]),
        all(
          `SELECT a.id, a.date, a.start_time, a.end_time, a.status, a.price, a.source,
                  a.created_at, a.updated_at,
                  c.name AS client_name,
                  b.name AS barber_name,
                  s.name AS service_name
             FROM appointments a
             JOIN clients c ON c.id = a.client_id
             JOIN barbers b ON b.id = a.barber_id
             LEFT JOIN services s ON s.id = a.service_id
            WHERE a.shop_id = ?
            ORDER BY COALESCE(a.updated_at, a.created_at) DESC, a.id DESC
            LIMIT 8`,
          [shopId]
        ),
      ]);

      const clientsTotal = Number(totalClientsRow?.total || 0);
      const recentActivity = recentRows.map((row) => ({
        id: Number(row.id),
        date: String(row.date || ''),
        start_time: String(row.start_time || ''),
        end_time: String(row.end_time || ''),
        status: String(row.status || 'pending'),
        price: Number(row.price || 0),
        source: String(row.source || 'admin'),
        created_at: String(row.created_at || ''),
        updated_at: row.updated_at ? String(row.updated_at) : null,
        client_name: decryptSensitiveField(String(row.client_name || '')),
        barber_name: String(row.barber_name || ''),
        service_name: row.service_name ? String(row.service_name) : null,
      }));

      const upcoming = (await listAppointments({ shopId, from: today }))
        .filter((item): item is Appointment => Boolean(item) && ['pending', 'confirmed'].includes(item.status))
        .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`))
        .slice(0, 6);

      const topServices = (
        await all(
          `SELECT COALESCE(s.name, 'Serviço removido') AS name, COUNT(*) AS total, COALESCE(SUM(a.price), 0) AS revenue
             FROM appointments a LEFT JOIN services s ON s.id = a.service_id
            WHERE a.shop_id = ? AND a.date BETWEEN ? AND ? AND a.status = 'completed'
            GROUP BY a.service_id ORDER BY total DESC, revenue DESC LIMIT 5`,
          [shopId, monthStart, monthEnd]
        )
      ).map((row) => ({ ...row, total: Number(row.total), revenue: Number(row.revenue || 0) }));

      const topBarbers = (
        await all(
          `SELECT b.name AS name, COUNT(*) AS total, COALESCE(SUM(a.price), 0) AS revenue
             FROM appointments a JOIN barbers b ON b.id = a.barber_id
            WHERE a.shop_id = ? AND a.date BETWEEN ? AND ? AND a.status = 'completed'
            GROUP BY a.barber_id ORDER BY total DESC, revenue DESC LIMIT 5`,
          [shopId, monthStart, monthEnd]
        )
      ).map((row) => ({ ...row, total: Number(row.total), revenue: Number(row.revenue || 0) }));

      return {
        status: 200,
        body: {
          date,
          today: {
            total: dayAppointments.length,
            pending: countByStatus.pending ?? 0,
            confirmed: countByStatus.confirmed ?? 0,
            completed: countByStatus.completed ?? 0,
            cancelled: countByStatus.cancelled ?? 0,
            no_show: countByStatus.no_show ?? 0,
            revenue_expected: sumBy(dayAppointments, (item) =>
              ['pending', 'confirmed', 'completed'].includes(item.status)
            ),
            revenue_realized: sumBy(dayAppointments, (item) => item.status === 'completed'),
            appointments: dayAppointments,
            occupancy: await occupancyFor(date, shopId),
          },
          week: {
            start: weekStart,
            end: weekEnd,
            total: weekAppointments.length,
            completed: completedWeek.length,
            revenue_realized: sumBy(completedWeek, () => true),
            revenue_expected: sumBy(weekAppointments, () => true),
          },
          month: {
            start: monthStart,
            end: monthEnd,
            total: monthAppointments.length,
            completed: completedMonth.length,
            revenue_realized: sumBy(completedMonth, () => true),
            revenue_expected: sumBy(monthAppointments, () => true),
            new_clients: Number(newClients?.total || 0),
            average_ticket: completedMonth.length
              ? Number((sumBy(completedMonth, () => true) / completedMonth.length).toFixed(2))
              : 0,
          },
          clients_total: clientsTotal,
          recent_activity: recentActivity,
          upcoming,
          top_services: topServices,
          top_barbers: topBarbers,
          shop_name: getSetting('shop_name', 'Gestor de Barbearia') ?? 'Gestor de Barbearia',
        },
      };
    },
  },
];
