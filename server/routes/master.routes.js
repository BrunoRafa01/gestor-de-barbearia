// Rotas exclusivas do Painel Master da Nova Runtime.
// Acesso restrito a sessoes com role === 'master'.

import { all, driverKind, get, healthCheck, run } from '../db.js';
import { HttpError } from '../http.js';
import { setShopPlan } from '../plans.js';
import { requiredId } from '../validate.js';

function requireMaster(session) {
  if (!session || session.role !== 'master') {
    throw new HttpError(403, 'Acesso restrito a administradores master da Nova Runtime.');
  }
}

export const masterRoutes = [
  {
    method: 'GET',
    path: '/api/master/overview',
    handler: async ({ session }) => {
      requireMaster(session);
      const [shopStats, apptStats, planRows, dbHealth] = await Promise.all([
        get(
          `SELECT COUNT(*) AS total_shops,
                  COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active_shops,
                  COALESCE(SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END), 0) AS suspended_shops
             FROM barbershops`,
          []
        ),
        get(
          `SELECT COUNT(*) AS total_appointments,
                  COALESCE(SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END), 0) AS platform_gmv
             FROM appointments`,
          []
        ),
        all(
          `SELECT COALESCE(s.plan_id, 'free') AS plan_id, COUNT(*) AS total
             FROM barbershops b
             LEFT JOIN subscriptions s ON s.shop_id = b.id
            GROUP BY COALESCE(s.plan_id, 'free')`,
          []
        ),
        healthCheck(),
      ]);

      return {
        status: 200,
        body: {
          platform: 'Nova Runtime',
          driver: driverKind(),
          database: dbHealth,
          shops: {
            total: Number(shopStats?.total_shops || 0),
            active: Number(shopStats?.active_shops || 0),
            suspended: Number(shopStats?.suspended_shops || 0),
          },
          appointments: {
            total: Number(apptStats?.total_appointments || 0),
            gmv: Number(apptStats?.platform_gmv || 0),
          },
          plans: planRows.map((r) => ({ plan_id: r.plan_id, total: Number(r.total) })),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/master/shops',
    handler: async ({ session }) => {
      requireMaster(session);
      const rows = await all(
        `SELECT b.id, b.slug, b.name, b.company, b.active, b.created_at,
                COALESCE(s.plan_id, 'free') AS plan_id,
                COALESCE(s.status, 'active') AS subscription_status,
                (SELECT COUNT(*) FROM users u WHERE u.shop_id = b.id AND u.active = 1) AS users_count,
                (SELECT COUNT(*) FROM barbers br WHERE br.shop_id = b.id AND br.active = 1) AS barbers_count,
                (SELECT COUNT(*) FROM appointments a WHERE a.shop_id = b.id) AS appointments_count
           FROM barbershops b
           LEFT JOIN subscriptions s ON s.shop_id = b.id
          ORDER BY b.id ASC`,
        []
      );
      return {
        status: 200,
        body: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          active: Number(row.active) === 1,
          users_count: Number(row.users_count || 0),
          barbers_count: Number(row.barbers_count || 0),
          appointments_count: Number(row.appointments_count || 0),
        })),
      };
    },
  },
  {
    method: 'PATCH',
    path: '/api/master/shops/:id',
    handler: async ({ params, body, session }) => {
      requireMaster(session);
      const id = requiredId(params.id, 'barbearia');
      const shop = await get('SELECT * FROM barbershops WHERE id = ?', [id]);
      if (!shop) throw new HttpError(404, 'Barbearia nao encontrada.');

      if (body.active !== undefined) {
        const nextActive = body.active ? 1 : 0;
        await run('UPDATE barbershops SET active = ? WHERE id = ?', [nextActive, id]);
      }

      if (body.plan_id) {
        await setShopPlan(id, String(body.plan_id), { provider: 'master-admin' });
      }

      const updated = await get(
        `SELECT b.*, COALESCE(s.plan_id, 'free') AS plan_id, COALESCE(s.status, 'active') AS subscription_status
           FROM barbershops b
           LEFT JOIN subscriptions s ON s.shop_id = b.id
          WHERE b.id = ?`,
        [id]
      );
      return {
        status: 200,
        body: { ...updated, id: Number(updated.id), active: Number(updated.active) === 1 },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/master/logs',
    handler: async ({ session }) => {
      requireMaster(session);
      const [recentShops, recentMessages] = await Promise.all([
        all('SELECT id, slug, name, active, created_at FROM barbershops ORDER BY id DESC LIMIT 15', []),
        all(
          'SELECT id, message_type AS type, status, created_at FROM whatsapp_messages ORDER BY id DESC LIMIT 20',
          []
        ),
      ]);
      return { status: 200, body: { recent_shops: recentShops, recent_messages: recentMessages } };
    },
  },
];
