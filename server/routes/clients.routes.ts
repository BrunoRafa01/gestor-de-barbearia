import { all, get, run } from '../db.js';
import { HttpError } from '../http.js';
import type { DbRow, RouteContext, RouteDefinition, SqlParam } from '../types.js';
import { digitsOnly, optionalEmail, optionalString, requiredId, requiredString } from '../validate.js';

function mapClient(row: DbRow | null) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    appointments_total:
      row.appointments_total === undefined ? undefined : Number(row.appointments_total),
  };
}

const CLIENT_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM appointments a WHERE a.client_id = c.id) AS appointments_total,
         (SELECT MAX(a.date) FROM appointments a
           WHERE a.client_id = c.id AND a.status = 'completed') AS last_visit
  FROM clients c
`;

/** Valida e normaliza o telefone (obrigatorio, com DDD). */
function phoneOrFail(value: unknown, field = 'telefone'): string {
  const phone = digitsOnly(requiredString(value, field));
  if (phone.length < 10 || phone.length > 11) {
    throw new HttpError(400, 'Informe um telefone valido com DDD (10 ou 11 digitos).');
  }
  return phone;
}

export const clientRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/clients',
    handler: async ({ query, shopId = 1 }: RouteContext) => {
      const where = ['c.shop_id = ?'];
      const params: SqlParam[] = [shopId];
      if (query.search) {
        where.push("(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')");
        const escaped = String(query.search).replace(/[\\%_]/g, '\\$&');
        const term = `%${escaped}%`;
        params.push(term, term, term);
      }
      const limit = query.limit ? Math.min(500, Math.max(1, Number(query.limit) || 100)) : null;
      const offset = query.offset ? Math.max(0, Number(query.offset) || 0) : 0;
      const paginationSql = limit ? ' LIMIT ? OFFSET ?' : '';
      if (limit) params.push(limit, offset);

      const sql = `${CLIENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY c.name COLLATE NOCASE ASC${paginationSql}`;
      const rows = await all(sql, params);
      return { status: 200, body: rows.map(mapClient) };
    },
  },
  {
    method: 'GET',
    path: '/api/clients/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'cliente');
      const client = mapClient(await get(`${CLIENT_SELECT} WHERE c.id = ? AND c.shop_id = ?`, [id, shopId]));
      if (!client) throw new HttpError(404, 'Cliente nao encontrado.');

      const history = await all(
        `SELECT a.id, a.date, a.start_time, a.end_time, a.status, a.price,
                b.name AS barber_name, s.name AS service_name
           FROM appointments a
           JOIN barbers b ON b.id = a.barber_id
           LEFT JOIN services s ON s.id = a.service_id
          WHERE a.client_id = ? AND a.shop_id = ?
          ORDER BY a.date DESC, a.start_time DESC`,
        [client.id, shopId]
      );

      return { status: 200, body: { ...client, history } };
    },
  },
  {
    method: 'POST',
    path: '/api/clients',
    handler: async ({ body, shopId = 1 }: RouteContext) => {
      const name = requiredString(body.name, 'nome do cliente', { max: 120 });
      const phone = phoneOrFail(body.phone);

      const duplicated = await get('SELECT id FROM clients WHERE shop_id = ? AND phone = ?', [shopId, phone]);
      if (duplicated) throw new HttpError(409, 'Ja existe um cliente com este telefone.');

      const info = await run(
        'INSERT INTO clients (shop_id, name, phone, email, birth_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [
          shopId,
          name,
          phone,
          optionalEmail(body.email),
          optionalString(body.birth_date, 'data de nascimento', 10),
          optionalString(body.notes, 'observacoes', 500),
        ]
      );

      return {
        status: 201,
        body: mapClient(await get(`${CLIENT_SELECT} WHERE c.id = ?`, [Number(info.lastInsertRowid)])),
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/clients/:id',
    handler: async ({ params, body, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'cliente');
      const existing = await get('SELECT id FROM clients WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Cliente nao encontrado.');

      const name = requiredString(body.name, 'nome do cliente', { max: 120 });
      const phone = phoneOrFail(body.phone);

      const duplicated = await get('SELECT id FROM clients WHERE shop_id = ? AND phone = ? AND id != ?', [shopId, phone, id]);
      if (duplicated) throw new HttpError(409, 'Ja existe outro cliente com este telefone.');

      await run(
        'UPDATE clients SET name = ?, phone = ?, email = ?, birth_date = ?, notes = ? WHERE id = ? AND shop_id = ?',
        [
          name,
          phone,
          optionalEmail(body.email),
          optionalString(body.birth_date, 'data de nascimento', 10),
          optionalString(body.notes, 'observacoes', 500),
          id,
          shopId,
        ]
      );

      return {
        status: 200,
        body: mapClient(await get(`${CLIENT_SELECT} WHERE c.id = ? AND c.shop_id = ?`, [id, shopId])),
      };
    },
  },
  {
    method: 'DELETE',
    path: '/api/clients/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'cliente');
      const existing = await get('SELECT id FROM clients WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Cliente nao encontrado.');
      const used = await get('SELECT COUNT(*) AS total FROM appointments WHERE client_id = ? AND shop_id = ?', [id, shopId]);
      if (Number(used?.total || 0) > 0) {
        throw new HttpError(
          409,
          'Nao e possivel excluir cliente com agendamentos registrados para preservar o historico financeiro.'
        );
      }
      await run('DELETE FROM clients WHERE id = ? AND shop_id = ?', [id, shopId]);
      return { status: 200, body: { deleted: true, id } };
    },
  },
];
