// Controle de planos, assinaturas e quotas SaaS por barbearia (tenant).

import { all, get, run } from './db.js';
import { HttpError } from './http.js';

export interface Plan {
  id: string;
  name: string;
  price_cents: number;
  max_barbers: number;
  max_services: number;
  whatsapp_cloud: boolean;
  reports_advanced: boolean;
}

export interface ShopPlan extends Plan {
  status: string;
  provider: string | null;
  current_period_end: string | null;
}

export interface SetShopPlanOptions {
  provider?: string;
  externalId?: string | null;
}

export type PlanFeatureKey = 'whatsapp_cloud' | 'reports_advanced';

export async function listPlans(): Promise<Plan[]> {
  const rows = await all('SELECT * FROM plans ORDER BY price_cents ASC', []);
  return rows.map((p) => ({
    id: String(p['id'] ?? ''),
    name: String(p['name'] ?? ''),
    price_cents: Number(p['price_cents'] ?? 0),
    max_barbers: Number(p['max_barbers'] ?? 2),
    max_services: Number(p['max_services'] ?? 10),
    whatsapp_cloud: Boolean(p['whatsapp_cloud']),
    reports_advanced: Boolean(p['reports_advanced']),
  }));
}

export async function getShopPlan(shopId: number = 1): Promise<ShopPlan> {
  const row = await get(
    `SELECT p.*, s.status AS sub_status, s.provider, s.current_period_end
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.shop_id = ?`,
    [Number(shopId) || 1]
  );
  if (row) {
    return {
      id: String(row['id'] ?? ''),
      name: String(row['name'] ?? ''),
      price_cents: Number(row['price_cents'] ?? 0),
      max_barbers: Number(row['max_barbers'] ?? 2),
      max_services: Number(row['max_services'] ?? 10),
      whatsapp_cloud: Boolean(row['whatsapp_cloud']),
      reports_advanced: Boolean(row['reports_advanced']),
      status: row['sub_status'] ? String(row['sub_status']) : 'active',
      provider: row['provider'] ? String(row['provider']) : null,
      current_period_end: row['current_period_end'] ? String(row['current_period_end']) : null,
    };
  }
  const defaultPlanId = Number(shopId) === 1 ? 'pro' : 'free';
  const fallback = await get('SELECT * FROM plans WHERE id = ?', [defaultPlanId]);
  return {
    id: fallback?.['id'] ? String(fallback['id']) : defaultPlanId,
    name: fallback?.['name']
      ? String(fallback['name'])
      : defaultPlanId === 'pro'
        ? 'Profissional'
        : 'Gratuito',
    price_cents: Number(fallback?.['price_cents'] || 0),
    max_barbers: Number(fallback?.['max_barbers'] || 2),
    max_services: Number(fallback?.['max_services'] || 10),
    whatsapp_cloud: Boolean(fallback?.['whatsapp_cloud']),
    reports_advanced: Boolean(fallback?.['reports_advanced']),
    status: 'active',
    provider: null,
    current_period_end: null,
  };
}

export async function setShopPlan(
  shopId: number,
  planId: string,
  { provider = 'manual', externalId = null }: SetShopPlanOptions = {}
): Promise<ShopPlan> {
  const plan = await get('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan) throw new HttpError(404, 'Plano nao encontrado.');
  await run(
    `INSERT INTO subscriptions (shop_id, plan_id, status, provider, external_id, updated_at)
     VALUES (?, ?, 'active', ?, ?, datetime('now','localtime'))
     ON CONFLICT(shop_id) DO UPDATE SET
       plan_id = excluded.plan_id,
       status = 'active',
       provider = excluded.provider,
       external_id = excluded.external_id,
       updated_at = datetime('now','localtime')`,
    [Number(shopId), planId, provider, externalId]
  );
  return getShopPlan(shopId);
}

export async function assertBarberQuota(shopId: number = 1): Promise<void> {
  const plan = await getShopPlan(shopId);
  const row = await get('SELECT COUNT(*) AS total FROM barbers WHERE shop_id = ? AND active = 1', [
    Number(shopId) || 1,
  ]);
  const used = Number(row?.['total'] || 0);
  if (used >= plan.max_barbers) {
    throw new HttpError(
      403,
      `Limite de ${plan.max_barbers} profissionais do plano ${plan.name} atingido. Faca upgrade para continuar.`
    );
  }
}

export async function assertFeature(
  shopId: number = 1,
  feature: PlanFeatureKey
): Promise<void> {
  const plan = await getShopPlan(shopId);
  if (!plan[feature]) {
    throw new HttpError(403, `Este recurso (${feature}) requer o plano Profissional.`);
  }
}
