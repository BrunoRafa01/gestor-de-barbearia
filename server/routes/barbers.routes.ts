import { getBarberHours, invalidateBarberHours } from '../availability.js';
import { all, batch, get, run } from '../db.js';
import { HttpError } from '../http.js';
import { assertBarberQuota } from '../plans.js';
import { WEEKDAYS } from '../time.js';
import type { BatchStatement, DbRow, RouteContext, RouteDefinition, SqlParam } from '../types.js';
import {
  boolFlag,
  optionalEmail,
  optionalId,
  optionalNumber,
  optionalString,
  optionalTime,
  requiredDate,
  requiredId,
  requiredString,
  requiredTime,
} from '../validate.js';

function mapBarber(row: DbRow) {
  return {
    ...row,
    id: Number(row.id),
    commission: Number(row.commission),
    active: Number(row.active),
  };
}

/** Converte o cache de jornada em uma lista ordenada por dia da semana. */
async function hoursFor(barberId: number) {
  const map = await getBarberHours(barberId);
  return [...map.values()]
    .sort((a, b) => Number(a.weekday) - Number(b.weekday))
    .map((row) => {
      const weekday = Number(row.weekday);
      return {
        ...row,
        id: Number(row.id),
        weekday,
        is_working: Number(row.is_working),
        label: WEEKDAYS[weekday] ?? '',
      };
    });
}

/** Instrucoes que copiam o horario da barbearia para um novo profissional. */
async function defaultHoursStatements(barberId: number): Promise<BatchStatement[]> {
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
      day.break_start ?? null,
      day.break_end ?? null,
    ],
  }));
}

export const barberRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/barbers',
    handler: async ({ query, shopId = 1 }: RouteContext) => {
      const where = ['shop_id = ?'];
      const params: SqlParam[] = [shopId];
      if (query.active === '1') where.push('active = 1');
      const sql = `SELECT * FROM barbers WHERE ${where.join(' AND ')}
                   ORDER BY active DESC, name COLLATE NOCASE ASC`;
      const barbers = (await all(sql, params)).map(mapBarber);
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
    handler: async ({ body, shopId = 1 }: RouteContext) => {
      await assertBarberQuota(shopId);
      const name = requiredString(body.name, 'nome do profissional', { max: 120 });

      const info = await run(
        'INSERT INTO barbers (shop_id, name, phone, email, color, commission, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          shopId,
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

      const created = await get('SELECT * FROM barbers WHERE id = ?', [barberId]);
      if (!created) throw new HttpError(500, 'Falha ao carregar profissional criado.');
      const barber = mapBarber(created);
      return { status: 201, body: { ...barber, hours: await hoursFor(barberId) } };
    },
  },
  {
    method: 'PUT',
    path: '/api/barbers/:id',
    handler: async ({ params, body, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');

      await run(
        `UPDATE barbers
            SET name = ?, phone = ?, email = ?, color = ?, commission = ?, active = ?
          WHERE id = ? AND shop_id = ?`,
        [
          requiredString(body.name, 'nome do profissional', { max: 120 }),
          optionalString(body.phone, 'telefone', 30),
          optionalEmail(body.email),
          optionalString(body.color, 'cor', 20),
          optionalNumber(body.commission, 'comissao', { min: 0, max: 100 }) ?? 0,
          boolFlag(body.active, Number(existing.active)),
          id,
          shopId,
        ]
      );

      const updated = await get('SELECT * FROM barbers WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!updated) throw new HttpError(404, 'Profissional nao encontrado.');
      const barber = mapBarber(updated);
      return { status: 200, body: { ...barber, hours: await hoursFor(id) } };
    },
  },
  {
    method: 'DELETE',
    path: '/api/barbers/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');

      const inUse = await get(
        'SELECT COUNT(*) AS total FROM appointments WHERE barber_id = ? AND shop_id = ?',
        [id, shopId]
      );

      if (Number(inUse?.total || 0) > 0) {
        await run('UPDATE barbers SET active = 0 WHERE id = ? AND shop_id = ?', [id, shopId]);
        return {
          status: 200,
          body: {
            deleted: false,
            deactivated: true,
            message: 'Profissional possui agendamentos e foi desativado.',
          },
        };
      }

      await run('DELETE FROM barbers WHERE id = ? AND shop_id = ?', [id, shopId]);
      invalidateBarberHours(id);
      return { status: 200, body: { deleted: true, id } };
    },
  },
  {
    method: 'GET',
    path: '/api/barbers/:id/hours',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');
      return { status: 200, body: await hoursFor(id) };
    },
  },
  {
    method: 'PUT',
    path: '/api/barbers/:id/hours',
    handler: async ({ params, body, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'profissional');
      const existing = await get('SELECT * FROM barbers WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Profissional nao encontrado.');

      const days = Array.isArray(body.days) ? body.days : [];
      if (!days.length) throw new HttpError(400, 'Informe os horarios de trabalho.');

      const statements: BatchStatement[] = [];

      for (const rawDay of days) {
        if (!rawDay || typeof rawDay !== 'object') continue;
        const day = rawDay as DbRow;
        const weekday = Number(day.weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
        const weekdayLabel = WEEKDAYS[weekday] ?? '';

        const isWorking = boolFlag(day.is_working, 1);
        const start = isWorking ? requiredTime(day.start_time || '09:00', 'hora inicial') : '09:00';
        const end = isWorking ? requiredTime(day.end_time || '19:00', 'hora final') : '19:00';

        if (isWorking && end <= start) {
          throw new HttpError(
            400,
            `No ${weekdayLabel} o horario final deve ser maior que o inicial.`
          );
        }

        const breakStart = isWorking ? optionalTime(day.break_start, 'inicio do intervalo') : null;
        const breakEnd = isWorking ? optionalTime(day.break_end, 'fim do intervalo') : null;

        if (isWorking && (breakStart === null) !== (breakEnd === null)) {
          throw new HttpError(
            400,
            `No ${weekdayLabel} informe o inicio e o fim do intervalo, ou deixe ambos vazios.`
          );
        }
        if (
          isWorking &&
          breakStart &&
          breakEnd &&
          (breakEnd <= breakStart || breakStart < start || breakEnd > end)
        ) {
          throw new HttpError(
            400,
            `No ${weekdayLabel} o intervalo deve estar dentro do horario de trabalho.`
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
  {
    method: 'GET',
    path: '/api/blocks',
    handler: async ({ query, shopId = 1 }: RouteContext) => {
      const where = ['b.shop_id = ?'];
      const params: SqlParam[] = [shopId];
      if (query.barber_id) {
        where.push('b.barber_id = ?');
        params.push(requiredId(query.barber_id, 'profissional'));
      }
      if (query.from) {
        where.push('b.date >= ?');
        params.push(requiredDate(query.from));
      }
      if (query.to) {
        where.push('b.date <= ?');
        params.push(requiredDate(query.to));
      }
      const rows = await all(
        `SELECT b.*, r.name AS barber_name
           FROM barber_blocks b
      LEFT JOIN barbers r ON r.id = b.barber_id
          WHERE ${where.join(' AND ')}
          ORDER BY b.date ASC, b.start_time ASC`,
        params
      );
      return { status: 200, body: rows };
    },
  },
  {
    method: 'POST',
    path: '/api/blocks',
    handler: async ({ body, shopId = 1 }: RouteContext) => {
      const barberId = optionalId(body.barber_id, 'profissional');
      if (barberId) {
        const barber = await get('SELECT id FROM barbers WHERE id = ? AND shop_id = ?', [
          barberId,
          shopId,
        ]);
        if (!barber) throw new HttpError(404, 'Profissional nao encontrado.');
      }
      const date = requiredDate(body.date);
      const startTime = requiredTime(body.start_time, 'horario inicial');
      const endTime = requiredTime(body.end_time, 'horario final');
      if (endTime <= startTime) {
        throw new HttpError(400, 'O horario final do bloqueio deve ser maior que o inicial.');
      }
      const reason = optionalString(body.reason, 'motivo', 200);
      const info = await run(
        'INSERT INTO barber_blocks (shop_id, barber_id, date, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?, ?)',
        [shopId, barberId, date, startTime, endTime, reason]
      );
      const created = await get('SELECT * FROM barber_blocks WHERE id = ?', [
        Number(info.lastInsertRowid),
      ]);
      return { status: 201, body: created };
    },
  },
  {
    method: 'DELETE',
    path: '/api/blocks/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'bloqueio');
      const existing = await get('SELECT id FROM barber_blocks WHERE id = ? AND shop_id = ?', [
        id,
        shopId,
      ]);
      if (!existing) throw new HttpError(404, 'Bloqueio nao encontrado.');
      await run('DELETE FROM barber_blocks WHERE id = ? AND shop_id = ?', [id, shopId]);
      return { status: 200, body: { deleted: true, id } };
    },
  },
];
