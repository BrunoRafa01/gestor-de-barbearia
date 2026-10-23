import { listAppointments } from '../appointments.js';
import { dayWindows } from '../availability.js';
import { all, get, getSetting } from '../db.js';
import { hhmmToMinutes, startOfWeek, endOfWeek, todayISO, toISODate } from '../time.js';

function sumBy(rows, predicate) {
  return rows.filter(predicate).reduce((total, row) => total + Number(row.price || 0), 0);
}

function monthRange(date) {
  const [year, month] = date.split('-').map(Number);
  const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const end = toISODate(new Date(year, month, 0));
  return { start, end };
}

/** Taxa de ocupacao do dia: minutos disponiveis x minutos agendados. */
async function occupancyFor(date) {
  const barbers = await all('SELECT id FROM barbers WHERE active = 1', []);
  let availableMinutes = 0;

  for (const barber of barbers) {
    const { windows } = await dayWindows(Number(barber.id), date);
    for (const [start, end] of windows) availableMinutes += end - start;
  }

  const appointments = (await listAppointments({ from: date, to: date })).filter((item) =>
    ['pending', 'confirmed', 'completed'].includes(item.status)
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

export const dashboardRoutes = [
  {
    method: 'GET',
    path: '/api/dashboard',
    handler: async ({ query }) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : todayISO();
      const today = todayISO();

      const dayAppointments = (await listAppointments({ from: date, to: date })).sort((a, b) =>
        a.start_time.localeCompare(b.start_time)
      );
      const countByStatus = dayAppointments.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});

      const weekStart = startOfWeek(date);
      const weekEnd = endOfWeek(date);
      const weekAppointments = (await listAppointments({ from: weekStart, to: weekEnd })).filter(
        (item) => item.status !== 'cancelled'
      );

      const { start: monthStart, end: monthEnd } = monthRange(date);
      const monthAppointments = (await listAppointments({ from: monthStart, to: monthEnd })).filter(
        (item) => item.status !== 'cancelled'
      );
      const completedMonth = monthAppointments.filter((item) => item.status === 'completed');

      const newClients = await get(
        'SELECT COUNT(*) AS total FROM clients WHERE date(created_at) >= ?',
        [monthStart]
      );

      const upcoming = (await listAppointments({ from: today }))
        .filter((item) => ['pending', 'confirmed'].includes(item.status))
        .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`))
        .slice(0, 6);

      const topServices = (
        await all(
          `SELECT s.name AS name, COUNT(*) AS total, SUM(a.price) AS revenue
             FROM appointments a JOIN services s ON s.id = a.service_id
            WHERE a.date BETWEEN ? AND ? AND a.status != 'cancelled'
            GROUP BY a.service_id ORDER BY total DESC LIMIT 5`,
          [monthStart, monthEnd]
        )
      ).map((row) => ({ ...row, total: Number(row.total), revenue: Number(row.revenue || 0) }));

      const topBarbers = (
        await all(
          `SELECT b.name AS name, COUNT(*) AS total, SUM(a.price) AS revenue
             FROM appointments a JOIN barbers b ON b.id = a.barber_id
            WHERE a.date BETWEEN ? AND ? AND a.status != 'cancelled'
            GROUP BY a.barber_id ORDER BY total DESC LIMIT 5`,
          [monthStart, monthEnd]
        )
      ).map((row) => ({ ...row, total: Number(row.total), revenue: Number(row.revenue || 0) }));

      return {
        status: 200,
        body: {
          date,
          today: {
            total: dayAppointments.length,
            pending: countByStatus.pending || 0,
            confirmed: countByStatus.confirmed || 0,
            completed: countByStatus.completed || 0,
            cancelled: countByStatus.cancelled || 0,
            no_show: countByStatus.no_show || 0,
            revenue_expected: sumBy(dayAppointments, (item) =>
              ['pending', 'confirmed', 'completed'].includes(item.status)
            ),
            revenue_realized: sumBy(dayAppointments, (item) => item.status === 'completed'),
            appointments: dayAppointments,
            occupancy: await occupancyFor(date),
          },
          week: {
            start: weekStart,
            end: weekEnd,
            total: weekAppointments.length,
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
              ? Number(sumBy(completedMonth, () => true) / completedMonth.length)
              : 0,
          },
          upcoming,
          top_services: topServices,
          top_barbers: topBarbers,
          shop_name: getSetting('shop_name', 'Gestor de Barbearia'),
        },
      };
    },
  },
];
