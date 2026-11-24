// Consultas por entidade para barbearias (multi-tenant), avaliacoes e configuracoes.

import { DEFAULT_SETTINGS, all, get, getSetting, getSettingsMap, run, setSetting } from './db-core.js';
import type { DbRow, DbRunResult } from './types.js';

export interface AddReviewInput {
  shopSlug?: string;
  clientName: string;
  rating: number;
  comment?: string | null;
  appointmentId?: number | null;
  barberId?: number | null;
}


export async function getShopBySlug(slug: string = 'nova-barbearia'): Promise<DbRow | null> {
  const shop = await get('SELECT * FROM barbershops WHERE slug = ? AND active = 1', [slug]);
  if (!shop && slug === 'nova-barbearia') {
    return await get('SELECT * FROM barbershops WHERE active = 1 ORDER BY id ASC LIMIT 1', []);
  }
  return shop || null;
}

export async function listShops(): Promise<DbRow[]> {
  return await all(
    'SELECT id, slug, name, company, description, logo_url, address, instagram, whatsapp FROM barbershops WHERE active = 1 ORDER BY name ASC',
    []
  );
}

export async function getShopReviews(slug: string = 'nova-barbearia'): Promise<DbRow[]> {
  return await all(
    'SELECT id, client_name, rating, comment, verified, created_at FROM reviews WHERE shop_slug = ? ORDER BY id DESC LIMIT 20',
    [slug]
  );
}

export async function addReview({
  shopSlug = 'nova-barbearia',
  clientName,
  rating,
  comment,
  appointmentId,
  barberId,
}: AddReviewInput): Promise<DbRunResult> {
  let verified = 0;
  if (appointmentId) {
    const appt = await get(
      `SELECT a.id, a.status
         FROM appointments a
         LEFT JOIN barbershops s ON s.id = a.shop_id
        WHERE a.id = ? AND (s.slug = ? OR (a.shop_id = 1 AND ? = 'nova-barbearia'))`,
      [Number(appointmentId), shopSlug, shopSlug]
    );
    if (appt && appt['status'] !== 'cancelled') {
      verified = 1;
    }
  }
  return await run(
    'INSERT INTO reviews (shop_slug, client_name, rating, comment, appointment_id, barber_id, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      shopSlug,
      clientName,
      Number(rating),
      comment || '',
      appointmentId || null,
      barberId || null,
      verified,
    ]
  );
}

export async function getAllShopSettings(
  shopId: number = 1
): Promise<Record<string, string | null>> {
  const sid = Number(shopId) || 1;
  const base: Record<string, string | null> =
    sid === 1 ? getSettingsMap() : { ...DEFAULT_SETTINGS };
  const rows = await all('SELECT key, value FROM shop_settings WHERE shop_id = ?', [sid]);
  for (const row of rows) {
    const k = String(row['key'] ?? '');
    if (k) {
      base[k] = row['value'] === null || row['value'] === undefined ? null : String(row['value']);
    }
  }
  return base;
}

export async function getShopSetting(
  shopId: number,
  key: string,
  fallback: string = ''
): Promise<string> {
  const sid = Number(shopId) || 1;
  const row = await get('SELECT value FROM shop_settings WHERE shop_id = ? AND key = ?', [sid, key]);
  if (row && row['value'] !== undefined && row['value'] !== null) {
    return String(row['value']);
  }
  if (sid === 1) return getSetting(key, fallback);
  return DEFAULT_SETTINGS[key] ?? fallback;
}

export async function setShopSetting(
  shopId: number,
  key: string,
  value: unknown
): Promise<void> {
  const sid = Number(shopId) || 1;
  const str = String(value ?? '');
  await run(
    `INSERT INTO shop_settings (shop_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(shop_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now','localtime')`,
    [sid, key, str]
  );
  if (sid === 1) {
    await setSetting(key, str);
  }
}

export async function getShopTimeZone(shopId: number = 1): Promise<string> {
  const sid = Number(shopId) || 1;
  const settingVal = await getShopSetting(sid, 'timezone', '');
  if (settingVal) return settingVal;
  const shopRow = await get('SELECT timezone FROM barbershops WHERE id = ?', [sid]);
  if (shopRow?.['timezone']) return String(shopRow['timezone']);
  return process.env.TZ || 'America/Fortaleza';
}
