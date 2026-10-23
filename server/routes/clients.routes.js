import { all, get, run } from '../db.js';
import { HttpError } from '../http.js';
import { digitsOnly, optionalEmail, optionalString, requiredId, requiredString } from '../validate.js';

function mapClient(row) {
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
function phoneOrFail(value, field = 'telefone') {
  const phone = digitsOnly(requiredString(value, field));
  if (phone.length < 10 || phone.length > 11) {
    throw new HttpError(400, 'Informe um telefone valido com DDD (10 ou 11 digitos).');
  }
  return phone;
}

export const clientRoutes = [
  {
    method: 'GET',
    path: '/api/clients',
    handler: async ({ query }) => {
      const where = [];
      const params = [];
      if (query.search) {
        where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
        const term = `%${query.search}%`;
        params.push(term, term, term);
      }
      const sql = `${CLIENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY c.name COLLATE NOCASE ASC`;
      const rows = await all(sql, params);
      return { status: 200, body: rows.map(mapClient) };
    },
  },
  {
    method: 'GET',
    path: '/api/clients/:id',
    handler: async ({ params }) => {
      const id = requiredId(params.id, 'cliente');
      const client = mapClient(await get(`${CLIENT_SELECT} WHERE c.id = ?`, [id]));
      if (!client) throw new HttpError(404, 'Cliente nao encontrado.');

      const history = await all(
        `SELECT a.id, a.date, a.start_time, a.end_time, a.status, a.price,
                b.name AS barber_name, s.name AS service_name
           FROM appointments a
           JOIN barbers b ON b.id = a.barber_id
           LEFT JOIN services s ON s.id = a.service_id
          WHERE a.client_id = ?
          ORDER BY a.date DESC, a.start_time DESC`,
        [client.id]
      );

      return { status: 200, body: { ...client, history } };
    },
  },
  {
    method: 'POST',
    path: '/api/clients',
    handler: async ({ body }) => {
      const name = requiredString(body.name, 'nome do cliente', { max: 120 });
      const phone = phoneOrFail(body.phone);

      const duplicated = await get('SELECT id FROM clients WHERE phone = ?', [phone]);
      if (duplicated) throw new HttpError(409, 'Ja existe um cliente com este telefone.');

      const info = await run(
        'INSERT INTO clients (name, phone, email, birth_date, notes) VALUES (?, ?, ?, ?, ?)',
        [
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
    handler: async ({ params, body }) => {
      const id = requiredId(params.id, 'cliente');
      const existing = await get('SELECT id FROM clients WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Cliente nao encontrado.');

      const name = requiredString(body.name, 'nome do cliente', { max: 120 });
      const phone = phoneOrFail(body.phone);

      const duplicated = await get('SELECT id FROM clients WHERE phone = ? AND id != ?', [phone, id]);
      if (duplicated) throw new HttpError(409, 'Ja existe outro cliente com este telefone.');

      await run(
        'UPDATE clients SET name = ?, phone = ?, email = ?, birth_date = ?, notes = ? WHERE id = ?',
        [
          name,
          phone,
          optionalEmail(body.email),
          optionalString(body.birth_date, 'data de nascimento', 10),
          optionalString(body.notes, 'observacoes', 500),
          id,
        ]
      );

      return { status: 200, body: mapClient(await get(`${CLIENT_SELECT} WHERE c.id = ?`, [id])) };
    },
  },
  {
    method: 'DELETE',
    path: '/api/clients/:id',
    handler: async ({ params }) => {
      const id = requiredId(params.id, 'cliente');
      const existing = await get('SELECT id FROM clients WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Cliente nao encontrado.');
      await run('DELETE FROM clients WHERE id = ?', [id]);
      return { status: 200, body: { deleted: true, id } };
    },
  },
];
