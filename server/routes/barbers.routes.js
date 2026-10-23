import { all, batch, get, run } from '../db.js';
import { getBarberHours, invalidateBarberHours } from '../availability.js';
import { HttpError } from '../http.js';
import {
  boolFlag,
  optionalEmail,
  optionalNumber,
  optionalString,
  optionalTime,
  requiredId,
  requiredString,
  requiredTime,
} from '../validate.js';
import { WEEKDAYS } from '../time.js';

function mapBarber(row) {
  return {
    ...row,
    id: Number(row.id),
    commission: Number(row.commission),
    active: Number(row.active),
  };
}

/** Converte o cache de jornada em uma lista ordenada por dia da semana. */
async function hoursFor(barberId) {
  const map = await getBarberHours(barberId);
  return [...map.values()]
    .sort((a, b) => Number(a.weekday) - Number(b.weekday))
    .map((row) => ({
      ...row,
      id: Number(row.id),
      weekday: Number(row.weekday),
      is_working: Number(row.is_working),
      label: WEEKDAYS[Number(row.weekday)],
    }));
}

/** Instrucoes que copiam o horario da barbearia para um novo profissional. */
async function defaultHoursStatements(barberId) {
  const business = await all('SELECT * FROM business_hours ORDER BY weekday', []);
  return business.map((day) => ({
    sql: `INSERT INTO barber_hours
            (barber_id, weekday, is_working, start_time, end_time, break_start, break_end)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      barberId,
      Number(day.weekday),
      Number(day.is_open),
      day.open_time,
      day.close_time,
      day.break_start,
      day.break_end,
    ],
  }));
}

export const barberRoutes = [
  {
    method: 'GET',
    path: '/api/barbers',
    handler: async ({ query }) => {
      const where = [];
      if (query.active === '1') where.push('active = 1');
      const sql = `SELECT * FROM barbers ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY active DESC, name COLLATE NOCASE ASC`;
      const barbers = (await all(sql, [])).map(mapBarber);
      return {
        status: 200,
        body: await Promise.all(
          barbers.map(async (barber) => ({ ...barber, hours: await hoursFor(barber.id) }))
        ),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/barbers',
    handler: async ({ body }) => {
      const name = requiredString(body.name, 'nome do profissional', { max: 120 });

      const info = await run(
        'INSERT INTO barbers (name, phone, email, color, commission, active) VALUES (?, ?, ?, ?, ?, ?)',
        [
          name,
          optionalString(body.phone, 'telefone', 30),
          optionalEmail(body.email),
          optionalString(body.color, 'cor', 20),
          optionalNumber(body.commission, 'comissao', { min: 0, max: 100 }) ?? 0,
          boolFlag(body.active, 1),
        ]
      );

      const barberId = Number(info.lastInsertRowid);
      const statements = await defaultHoursStatements(barberId);
      if (statements.length) await batch(statements);
      invalidateBarberHours(barberId);

      const barber = mapBarber(await get('SELECT * FROM barbers WHERE id = ?', [barberId]));
      return { status: 201, body: { ...barber, hours: await hoursFor(barberId) } };
    },
  },
  {
    method: 'PUT',
    path: '/api/barbers/:id',
    handler: async ({ params, body }) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');

      await run(
        `UPDATE barbers
            SET name = ?, phone = ?, email = ?, color = ?, commission = ?, active = ?
          WHERE id = ?`,
        [
          requiredString(body.name, 'nome do profissional', { max: 120 }),
          optionalString(body.phone, 'telefone', 30),
          optionalEmail(body.email),
          optionalString(body.color, 'cor', 20),
          optionalNumber(body.commission, 'comissao', { min: 0, max: 100 }) ?? 0,
          boolFlag(body.active, existing.active),
          id,
        ]
      );

      const barber = mapBarber(await get('SELECT * FROM barbers WHERE id = ?', [id]));
      return { status: 200, body: { ...barber, hours: await hoursFor(id) } };
    },
  },
  {
    method: 'DELETE',
    path: '/api/barbers/:id',
    handler: async ({ params }) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');

      const inUse = await get('SELECT COUNT(*) AS total FROM appointments WHERE barber_id = ?', [id]);

      if (Number(inUse?.total || 0) > 0) {
        await run('UPDATE barbers SET active = 0 WHERE id = ?', [id]);
        return {
          status: 200,
          body: {
            deleted: false,
            deactivated: true,
            message: 'Profissional possui agendamentos e foi desativado.',
          },
        };
      }

      await run('DELETE FROM barbers WHERE id = ?', [id]);
      invalidateBarberHours(id);
      return { status: 200, body: { deleted: true, id } };
    },
  },
  {
    method: 'GET',
    path: '/api/barbers/:id/hours',
    handler: async ({ params }) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');
      return { status: 200, body: await hoursFor(id) };
    },
  },
  {
    method: 'PUT',
    path: '/api/barbers/:id/hours',
    handler: async ({ params, body }) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');

      const days = Array.isArray(body.days) ? body.days : [];
      if (!days.length) throw new HttpError(400, 'Informe os horarios de trabalho.');

      const statements = [];

      for (const day of days) {
        const weekday = Number(day.weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;

        const isWorking = boolFlag(day.is_working, 1);
        const start = isWorking ? requiredTime(day.start_time || '09:00', 'hora inicial') : '09:00';
        const end = isWorking ? requiredTime(day.end_time || '19:00', 'hora final') : '19:00';

        if (isWorking && end <= start) {
          throw new HttpError(
            400,
            `No ${WEEKDAYS[weekday]} o horario final deve ser maior que o inicial.`
          );
        }

        const breakStart = isWorking ? optionalTime(day.break_start, 'inicio do intervalo') : null;
        const breakEnd = isWorking ? optionalTime(day.break_end, 'fim do intervalo') : null;

        if (isWorking && (breakStart === null) !== (breakEnd === null)) {
          throw new HttpError(
            400,
            `No ${WEEKDAYS[weekday]} informe o inicio e o fim do intervalo, ou deixe ambos vazios.`
          );
        }
        if (isWorking && breakStart && breakEnd && (breakEnd <= breakStart || breakStart < start || breakEnd > end)) {
          throw new HttpError(
            400,
            `No ${WEEKDAYS[weekday]} o intervalo deve estar dentro do horario de trabalho.`
          );
        }

        statements.push({
          sql: `UPDATE barber_hours
                   SET is_working = ?, start_time = ?, end_time = ?, break_start = ?, break_end = ?
                 WHERE barber_id = ? AND weekday = ?`,
          params: [isWorking, start, end, breakStart, breakEnd, id, weekday],
        });
      }

      if (statements.length) await batch(statements);
      invalidateBarberHours(id);

      return { status: 200, body: await hoursFor(id) };
    },
  },
];
