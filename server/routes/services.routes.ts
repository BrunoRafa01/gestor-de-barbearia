import { all, get, run } from '../db.js';
import { HttpError } from '../http.js';
import type { DbRow, RouteContext, RouteDefinition, SqlParam } from '../types.js';
import { boolFlag, optionalString, requiredId, requiredNumber, requiredString } from '../validate.js';

function mapService(row: DbRow) {
  return {
    ...row,
    id: Number(row.id),
    duration_min: Number(row.duration_min),
    price: Number(row.price),
    active: Number(row.active),
  };
}

export const serviceRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/services',
    handler: async ({ query, shopId = 1 }: RouteContext) => {
      const where = ['shop_id = ?'];
      const params: SqlParam[] = [shopId];
      if (query.active === '1') where.push('active = 1');
      const sql = `SELECT * FROM services WHERE ${where.join(' AND ')}
                   ORDER BY active DESC, name COLLATE NOCASE ASC`;
      const rows = await all(sql, params);
      return { status: 200, body: rows.map(mapService) };
    },
  },
  {
    method: 'POST',
    path: '/api/services',
    handler: async ({ body, shopId = 1 }: RouteContext) => {
      const name = requiredString(body.name, 'nome do servico', { max: 120 });
      const duration = requiredNumber(body.duration_min, 'duracao', { min: 5, max: 600 });
      const price = requiredNumber(body.price, 'preco', { min: 0, max: 100000 });

      const info = await run(
        'INSERT INTO services (shop_id, name, description, duration_min, price, active) VALUES (?, ?, ?, ?, ?, ?)',
        [
          shopId,
          name,
          optionalString(body.description, 'descricao', 300),
          Math.round(duration),
          price,
          boolFlag(body.active, 1),
        ]
      );

      const created = await get('SELECT * FROM services WHERE id = ?', [Number(info.lastInsertRowid)]);
      if (!created) throw new HttpError(500, 'Falha ao carregar servico criado.');

      return {
        status: 201,
        body: mapService(created),
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/services/:id',
    handler: async ({ params, body, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'servico');
      const existing = await get('SELECT * FROM services WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Servico nao encontrado.');

      await run(
        'UPDATE services SET name = ?, description = ?, duration_min = ?, price = ?, active = ? WHERE id = ? AND shop_id = ?',
        [
          requiredString(body.name, 'nome do servico', { max: 120 }),
          optionalString(body.description, 'descricao', 300),
          Math.round(requiredNumber(body.duration_min, 'duracao', { min: 5, max: 600 })),
          requiredNumber(body.price, 'preco', { min: 0, max: 100000 }),
          boolFlag(body.active, Number(existing.active)),
          id,
          shopId,
        ]
      );

      const updated = await get('SELECT * FROM services WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!updated) throw new HttpError(404, 'Servico nao encontrado.');

      return { status: 200, body: mapService(updated) };
    },
  },
  {
    method: 'DELETE',
    path: '/api/services/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'servico');
      const existing = await get('SELECT * FROM services WHERE id = ? AND shop_id = ?', [id, shopId]);
      if (!existing) throw new HttpError(404, 'Servico nao encontrado.');

      const inUse = await get('SELECT COUNT(*) AS total FROM appointments WHERE service_id = ? AND shop_id = ?', [id, shopId]);

      if (Number(inUse?.total || 0) > 0) {
        // Mantem o historico: apenas desativa o servico.
        await run('UPDATE services SET active = 0 WHERE id = ? AND shop_id = ?', [id, shopId]);
        return {
          status: 200,
          body: {
            deleted: false,
            deactivated: true,
            message: 'Servico possui agendamentos e foi desativado.',
          },
        };
      }

      await run('DELETE FROM services WHERE id = ? AND shop_id = ?', [id, shopId]);
      return { status: 200, body: { deleted: true, id } };
    },
  },
];
