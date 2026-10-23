import { all, get, run } from '../db.js';
import { HttpError } from '../http.js';
import { boolFlag, optionalString, requiredId, requiredNumber, requiredString } from '../validate.js';

function mapService(row) {
  return {
    ...row,
    id: Number(row.id),
    duration_min: Number(row.duration_min),
    price: Number(row.price),
    active: Number(row.active),
  };
}

export const serviceRoutes = [
  {
    method: 'GET',
    path: '/api/services',
    handler: async ({ query }) => {
      const where = [];
      if (query.active === '1') where.push('active = 1');
      const sql = `SELECT * FROM services ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY active DESC, name COLLATE NOCASE ASC`;
      const rows = await all(sql, []);
      return { status: 200, body: rows.map(mapService) };
    },
  },
  {
    method: 'POST',
    path: '/api/services',
    handler: async ({ body }) => {
      const name = requiredString(body.name, 'nome do servico', { max: 120 });
      const duration = requiredNumber(body.duration_min, 'duracao', { min: 5, max: 600 });
      const price = requiredNumber(body.price, 'preco', { min: 0, max: 100000 });

      const info = await run(
        'INSERT INTO services (name, description, duration_min, price, active) VALUES (?, ?, ?, ?, ?)',
        [
          name,
          optionalString(body.description, 'descricao', 300),
          Math.round(duration),
          price,
          boolFlag(body.active, 1),
        ]
      );

      return {
        status: 201,
        body: mapService(await get('SELECT * FROM services WHERE id = ?', [Number(info.lastInsertRowid)])),
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/services/:id',
    handler: async ({ params, body }) => {
      const id = requiredId(params.id, 'servico');
      const existing = await get('SELECT * FROM services WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Servico nao encontrado.');

      await run(
        'UPDATE services SET name = ?, description = ?, duration_min = ?, price = ?, active = ? WHERE id = ?',
        [
          requiredString(body.name, 'nome do servico', { max: 120 }),
          optionalString(body.description, 'descricao', 300),
          Math.round(requiredNumber(body.duration_min, 'duracao', { min: 5, max: 600 })),
          requiredNumber(body.price, 'preco', { min: 0, max: 100000 }),
          boolFlag(body.active, existing.active),
          id,
        ]
      );

      return { status: 200, body: mapService(await get('SELECT * FROM services WHERE id = ?', [id])) };
    },
  },
  {
    method: 'DELETE',
    path: '/api/services/:id',
    handler: async ({ params }) => {
      const id = requiredId(params.id, 'servico');
      const existing = await get('SELECT * FROM services WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Servico nao encontrado.');

      const inUse = await get('SELECT COUNT(*) AS total FROM appointments WHERE service_id = ?', [id]);

      if (Number(inUse?.total || 0) > 0) {
        // Mantem o historico: apenas desativa o servico.
        await run('UPDATE services SET active = 0 WHERE id = ?', [id]);
        return {
          status: 200,
          body: {
            deleted: false,
            deactivated: true,
            message: 'Servico possui agendamentos e foi desativado.',
          },
        };
      }

      await run('DELETE FROM services WHERE id = ?', [id]);
      return { status: 200, body: { deleted: true, id } };
    },
  },
];
