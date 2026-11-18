// Regras de negocio dos agendamentos, compartilhadas entre o painel e a
// pagina publica de agendamento.
//
// Protecao contra duplicidade (duas camadas):
//   1. `assertSlotAvailable` valida o horario na grade de disponibilidade;
//   2. o INSERT/UPDATE so grava se NAO existir outro agendamento ativo que se
//      sobreponha ao intervalo - resolvido em uma unica instrucao SQL, o que
//      evita a janela de corrida entre "verificar" e "gravar" mesmo com o banco
//      remoto (Turso) e requisicoes simultaneas.
// Alem disso o indice unico parcial `uniq_appointment_slot` e a ultima linha
// de defesa no proprio banco.

import { randomBytes } from 'node:crypto';
import { assertSlotAvailable, endTimeFor } from './availability.js';
import { all, get, getSetting, run } from './db.js';
import { PAYMENT_METHODS } from './finance.js';
import { HttpError } from './http.js';
import { ACTIVE_STATUSES, addDays, isValidStatus, todayISO } from './time.js';
import type {
  Appointment,
  AppointmentSource,
  AppointmentStatus,
  Barber,
  Client,
  DbRow,
  Service,
} from './types.js';
import {
  optionalString,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredTime,
} from './validate.js';

const APPOINTMENT_SELECT = `
  SELECT a.id, a.shop_id, a.client_id, a.barber_id, a.service_id, a.date, a.start_time, a.end_time,
         a.status, a.price, a.payment_method, a.notes, a.source, a.cancel_token, a.created_at, a.updated_at,
         c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
         b.name AS barber_name, b.color AS barber_color,
         s.name AS service_name, s.duration_min AS service_duration
  FROM appointments a
  JOIN clients  c ON c.id = a.client_id
  JOIN barbers  b ON b.id = a.barber_id
  LEFT JOIN services s ON s.id = a.service_id
`;

const ACTIVE_SQL = ACTIVE_STATUSES.map((status) => `'${status}'`).join(',');

const ALL_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
];

const CREATE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'pending',
  'confirmed',
  'completed',
];

export interface ListAppointmentsFilters {
  shopId?: number | null;
  from?: string | null;
  to?: string | null;
  barberId?: number | string | null;
  clientId?: number | string | null;
  status?: string | null;
  search?: string | null;
}

export interface CreateAppointmentInput {
  shop_id?: number | null;
  client_id?: unknown;
  barber_id?: unknown;
  service_id?: unknown;
  date?: unknown;
  start_time?: unknown;
  status?: unknown;
  source?: unknown;
  notes?: unknown;
  price?: unknown;
  payment_method?: unknown;
  cancel_token?: string | null;
}

export interface UpdateAppointmentInput {
  client_id?: unknown;
  barber_id?: unknown;
  service_id?: unknown;
  date?: unknown;
  start_time?: unknown;
  status?: unknown;
  notes?: unknown;
  price?: unknown;
  payment_method?: unknown;
}

export interface UpsertClientByPhoneInput {
  name: string;
  phone: string;
  email?: string | null;
  shopId?: number;
  shop_id?: number;
}

function mapRow(row: DbRow | null): Appointment | null {
  if (!row) return null;
  const rawStatus = String(row['status'] ?? 'pending');
  const status: AppointmentStatus = isValidStatus(rawStatus) ? rawStatus : 'pending';
  const source: AppointmentSource = row['source'] === 'public' ? 'public' : 'admin';

  return {
    id: Number(row['id']),
    shop_id: row['shop_id'] !== undefined ? Number(row['shop_id']) : undefined,
    client_id: Number(row['client_id']),
    barber_id: Number(row['barber_id']),
    service_id:
      row['service_id'] === null || row['service_id'] === undefined
        ? null
        : Number(row['service_id']),
    date: String(row['date'] ?? ''),
    start_time: String(row['start_time'] ?? ''),
    end_time: String(row['end_time'] ?? ''),
    status,
    price: Number(row['price'] || 0),
    payment_method: row['payment_method'] ? String(row['payment_method']) : null,
    notes: row['notes'] ? String(row['notes']) : null,
    source,
    cancel_token: row['cancel_token'] ? String(row['cancel_token']) : null,
    created_at: String(row['created_at'] ?? ''),
    updated_at: row['updated_at'] ? String(row['updated_at']) : null,
    client_name: row['client_name'] ? String(row['client_name']) : undefined,
    client_phone: row['client_phone'] ? String(row['client_phone']) : undefined,
    client_email: row['client_email'] ? String(row['client_email']) : null,
    barber_name: row['barber_name'] ? String(row['barber_name']) : undefined,
    barber_color: row['barber_color'] ? String(row['barber_color']) : null,
    service_name: row['service_name'] ? String(row['service_name']) : null,
    service_duration:
      row['service_duration'] === null || row['service_duration'] === undefined
        ? null
        : Number(row['service_duration']),
  };
}

function mapClientRow(row: DbRow): Client {
  return {
    id: Number(row['id']),
    shop_id: row['shop_id'] !== undefined ? Number(row['shop_id']) : undefined,
    name: String(row['name'] ?? ''),
    phone: String(row['phone'] ?? ''),
    email: row['email'] ? String(row['email']) : null,
    notes: row['notes'] ? String(row['notes']) : null,
    created_at: String(row['created_at'] ?? ''),
  };
}

export async function getAppointmentById(
  id: number | string,
  shopId: number | null = null
): Promise<Appointment | null> {
  if (shopId) {
    const row = await get(`${APPOINTMENT_SELECT} WHERE a.id = ? AND a.shop_id = ?`, [
      Number(id),
      Number(shopId),
    ]);
    return mapRow(row);
  }
  const row = await get(`${APPOINTMENT_SELECT} WHERE a.id = ?`, [Number(id)]);
  return mapRow(row);
}

export async function getAppointmentByCancelToken(
  token: string | null | undefined
): Promise<Appointment | null> {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const row = await get(`${APPOINTMENT_SELECT} WHERE a.cancel_token = ?`, [token]);
  return mapRow(row);
}

export async function listAppointments(
  filters: ListAppointmentsFilters = {}
): Promise<Appointment[]> {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (filters.shopId) {
    where.push('a.shop_id = ?');
    params.push(Number(filters.shopId));
  }
  if (filters.from) {
    where.push('a.date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.date <= ?');
    params.push(filters.to);
  }
  if (filters.barberId) {
    where.push('a.barber_id = ?');
    params.push(Number(filters.barberId));
  }
  if (filters.clientId) {
    where.push('a.client_id = ?');
    params.push(Number(filters.clientId));
  }
  if (filters.status && isValidStatus(filters.status)) {
    where.push('a.status = ?');
    params.push(filters.status);
  }
  if (filters.search) {
    const escaped = String(filters.search).replace(/[\\%_]/g, '\\$&');
    where.push(
      "(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')"
    );
    const term = `%${escaped}%`;
    params.push(term, term, term);
  }

  const sql = `${APPOINTMENT_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.date DESC, a.start_time DESC`;

  const rows = await all(sql, params);
  return rows.map((row) => mapRow(row)).filter((item): item is Appointment => item !== null);
}

async function loadService(
  serviceId: number,
  { requireActive = false, shopId = null }: { requireActive?: boolean; shopId?: number | null } = {}
): Promise<Service> {
  const service = shopId
    ? await get('SELECT * FROM services WHERE id = ? AND shop_id = ?', [serviceId, Number(shopId)])
    : await get('SELECT * FROM services WHERE id = ?', [serviceId]);
  if (!service) throw new HttpError(404, 'Servico nao encontrado.');
  if (requireActive && !service['active']) {
    throw new HttpError(409, 'Este servico esta inativo.');
  }
  return {
    id: Number(service['id']),
    shop_id: service['shop_id'] !== undefined ? Number(service['shop_id']) : undefined,
    name: String(service['name'] ?? ''),
    price: Number(service['price'] || 0),
    duration_min: Number(service['duration_min'] || 30),
    description: service['description'] ? String(service['description']) : null,
    active: Number(service['active'] ?? 1),
    created_at: String(service['created_at'] ?? ''),
  };
}

async function loadBarber(
  barberId: number,
  { requireActive = false, shopId = null }: { requireActive?: boolean; shopId?: number | null } = {}
): Promise<Barber> {
  const barber = shopId
    ? await get('SELECT * FROM barbers WHERE id = ? AND shop_id = ?', [barberId, Number(shopId)])
    : await get('SELECT * FROM barbers WHERE id = ?', [barberId]);
  if (!barber) throw new HttpError(404, 'Profissional nao encontrado.');
  if (requireActive && !barber['active']) {
    throw new HttpError(409, 'Este profissional esta inativo.');
  }
  return {
    id: Number(barber['id']),
    shop_id: barber['shop_id'] !== undefined ? Number(barber['shop_id']) : undefined,
    name: String(barber['name'] ?? ''),
    phone: barber['phone'] ? String(barber['phone']) : null,
    email: barber['email'] ? String(barber['email']) : null,
    color: barber['color'] ? String(barber['color']) : null,
    commission: Number(barber['commission'] || 0),
    active: Number(barber['active'] ?? 1),
    created_at: String(barber['created_at'] ?? ''),
  };
}

function parsePrice(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, 'Informe um preco valido.');
  }
  return Math.round(parsed * 100) / 100;
}

async function loadClient(clientId: number, shopId: number | null = null): Promise<Client> {
  const client = shopId
    ? await get('SELECT * FROM clients WHERE id = ? AND shop_id = ?', [clientId, Number(shopId)])
    : await get('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) throw new HttpError(404, 'Cliente nao encontrado.');
  return mapClientRow(client);
}

interface InsertIfFreeParams {
  shopId?: number;
  clientId: number;
  barberId: number;
  serviceId: number;
  date: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  price: number;
  paymentMethod?: string;
  notes: string | null;
  source: AppointmentSource;
  cancelToken: string;
}

/**
 * Insere o agendamento somente se o intervalo estiver livre.
 * Retorna `null` quando houve conflito (outra requisicao gravou no meio).
 */
async function insertIfFree({
  shopId = 1,
  clientId,
  barberId,
  serviceId,
  date,
  startTime,
  endTime,
  status,
  price,
  paymentMethod = 'pix',
  notes,
  source,
  cancelToken,
}: InsertIfFreeParams): Promise<number | null> {
  const info = await run(
    `INSERT INTO appointments
       (shop_id, client_id, barber_id, service_id, date, start_time, end_time, status, price, payment_method, notes, source, cancel_token)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.barber_id = ?
           AND a.date = ?
           AND a.status IN (${ACTIVE_SQL})
           AND a.start_time < ?
           AND a.end_time   > ?
      )`,
    [
      shopId,
      clientId,
      barberId,
      serviceId,
      date,
      startTime,
      endTime,
      status,
      price,
      paymentMethod,
      notes,
      source,
      cancelToken,
      barberId,
      date,
      endTime,
      startTime,
    ]
  );
  return info.changes > 0 ? Number(info.lastInsertRowid) : null;
}

export async function createAppointment(
  input: CreateAppointmentInput | Record<string, unknown>,
  now: Date = new Date()
): Promise<Appointment> {
  const data = input as CreateAppointmentInput;
  const shopId = Number(data.shop_id) || 1;
  const clientId = requiredId(data.client_id, 'cliente');
  const barberId = requiredId(data.barber_id, 'profissional');
  const serviceId = requiredId(data.service_id, 'servico');
  const date = requiredDate(data.date);
  const startTime = requiredTime(data.start_time, 'horario');
  const status: AppointmentStatus = data.status
    ? requiredEnum(String(data.status), CREATE_APPOINTMENT_STATUSES, 'status')
    : 'pending';
  const source: AppointmentSource = data.source === 'public' ? 'public' : 'admin';
  const notes = optionalString(data.notes, 'observacoes', 500);

  if (source === 'public') {
    const maxDays = Math.max(1, Number(getSetting('max_advance_days', '30')) || 30);
    if (date > addDays(todayISO(now), maxDays)) {
      throw new HttpError(
        400,
        `Agendamentos disponiveis apenas para os proximos ${maxDays} dias.`
      );
    }
  }

  await Promise.all([
    loadClient(clientId, shopId),
    loadBarber(barberId, { requireActive: true, shopId }),
    loadService(serviceId, { requireActive: true, shopId }),
  ]);

  const availability = await assertSlotAvailable({ barberId, serviceId, date, startTime, now });
  const endTime = endTimeFor(startTime, availability.duration);
  const price =
    data.price === undefined || data.price === null || data.price === ''
      ? availability.price
      : parsePrice(data.price);
  const paymentMethod = data.payment_method
    ? requiredEnum(String(data.payment_method), PAYMENT_METHODS, 'forma de pagamento')
    : 'pix';

  const cancelToken = data.cancel_token || randomBytes(16).toString('hex');

  const id = await insertIfFree({
    shopId,
    clientId,
    barberId,
    serviceId,
    date,
    startTime,
    endTime,
    status,
    price,
    paymentMethod,
    notes,
    source,
    cancelToken,
  });

  if (id === null) {
    throw new HttpError(409, 'Este horario acabou de ser reservado. Escolha outro horario livre.');
  }

  const created = await getAppointmentById(id, shopId);
  if (!created) {
    throw new HttpError(500, 'Falha ao carregar o agendamento recem-criado.');
  }
  return created;
}

export async function updateAppointment(
  id: number | string,
  input: UpdateAppointmentInput | Record<string, unknown>,
  now: Date = new Date(),
  { shopId = null }: { shopId?: number | null } = {}
): Promise<Appointment> {
  const data = input as UpdateAppointmentInput;
  const appointmentId = Number(id);
  const current = await getAppointmentById(appointmentId, shopId);
  if (!current) throw new HttpError(404, 'Agendamento nao encontrado.');
  const effectiveShopId = shopId || Number(current.shop_id) || 1;

  const clientId = data.client_id ? requiredId(data.client_id, 'cliente') : current.client_id;
  const barberId = data.barber_id ? requiredId(data.barber_id, 'profissional') : current.barber_id;
  const serviceId = data.service_id
    ? requiredId(data.service_id, 'servico')
    : requiredId(current.service_id, 'servico');
  const date = data.date ? requiredDate(data.date) : current.date;
  const startTime = data.start_time
    ? requiredTime(data.start_time, 'horario')
    : current.start_time;
  const status: AppointmentStatus = data.status
    ? requiredEnum(String(data.status), ALL_APPOINTMENT_STATUSES, 'status')
    : current.status;
  const notes =
    data.notes === undefined ? current.notes : optionalString(data.notes, 'observacoes', 500);

  await loadClient(clientId, effectiveShopId);
  await loadBarber(barberId, {
    requireActive: barberId !== current.barber_id,
    shopId: effectiveShopId,
  });
  const service = await loadService(serviceId, {
    requireActive: serviceId !== current.service_id,
    shopId: effectiveShopId,
  });
  const isCancelled = status === 'cancelled' || status === 'no_show';

  if (!isCancelled) {
    await assertSlotAvailable({
      barberId,
      serviceId,
      date,
      startTime,
      excludeId: appointmentId,
      now,
    });
  }

  const endTime = endTimeFor(startTime, service.duration_min);
  const hasExplicitPrice = data.price !== undefined && data.price !== null && data.price !== '';
  const serviceChanged = serviceId !== current.service_id;
  const price = hasExplicitPrice
    ? parsePrice(data.price)
    : serviceChanged
      ? Number(service.price)
      : Number(current.price);
  const paymentMethod = data.payment_method
    ? requiredEnum(String(data.payment_method), PAYMENT_METHODS, 'forma de pagamento')
    : current.payment_method || 'pix';

  const updateInfo = await run(
    `UPDATE appointments
        SET client_id = ?, barber_id = ?, service_id = ?, date = ?, start_time = ?, end_time = ?,
            status = ?, price = ?, payment_method = ?, notes = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
        AND (
          ? IN ('cancelled', 'no_show')
          OR NOT EXISTS (
            SELECT 1 FROM appointments a
             WHERE a.id != ?
               AND a.barber_id = ?
               AND a.date = ?
               AND a.status IN (${ACTIVE_SQL})
               AND a.start_time < ?
               AND a.end_time   > ?
          )
        )`,
    [
      clientId,
      barberId,
      serviceId,
      date,
      startTime,
      endTime,
      status,
      price,
      paymentMethod,
      notes,
      appointmentId,
      status,
      appointmentId,
      barberId,
      date,
      endTime,
      startTime,
    ]
  );

  if (updateInfo.changes === 0) {
    throw new HttpError(
      409,
      'Este horário está em conflito com outro agendamento. Escolha outro horário livre.'
    );
  }

  const updated = await getAppointmentById(appointmentId);
  if (!updated) {
    throw new HttpError(500, 'Falha ao carregar o agendamento atualizado.');
  }
  return updated;
}

export async function setAppointmentStatus(
  id: number | string,
  status: unknown,
  { shopId = null }: { shopId?: number | null } = {}
): Promise<Appointment> {
  const appointmentId = Number(id);
  const appointment = await getAppointmentById(appointmentId, shopId);
  if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');

  const nextStatus = requiredEnum(String(status), ALL_APPOINTMENT_STATUSES, 'status');

  if (appointment.status === nextStatus) return appointment;

  // Ao reativar um agendamento cancelado, o horario precisa estar livre novamente (validacao + UPDATE atomico).
  if ((ACTIVE_STATUSES as readonly string[]).includes(nextStatus)) {
    await assertSlotAvailable({
      barberId: appointment.barber_id,
      serviceId: requiredId(appointment.service_id, 'servico'),
      date: appointment.date,
      startTime: appointment.start_time,
      excludeId: appointmentId,
    });
  }

  const updateInfo = await run(
    `UPDATE appointments
        SET status = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
        AND (
          ? NOT IN (${ACTIVE_SQL})
          OR NOT EXISTS (
            SELECT 1 FROM appointments a
             WHERE a.id != ?
               AND a.barber_id = appointments.barber_id
               AND a.date = appointments.date
               AND a.status IN (${ACTIVE_SQL})
               AND a.start_time < appointments.end_time
               AND a.end_time   > appointments.start_time
          )
        )`,
    [nextStatus, appointmentId, nextStatus, appointmentId]
  );

  if (updateInfo.changes === 0) {
    throw new HttpError(409, 'Este horario esta em conflito com outro agendamento.');
  }

  const updated = await getAppointmentById(appointmentId);
  if (!updated) {
    throw new HttpError(500, 'Falha ao carregar o agendamento atualizado.');
  }
  return updated;
}

export async function deleteAppointment(
  id: number | string,
  { shopId = null }: { shopId?: number | null } = {}
): Promise<{ deleted: true; id: number }> {
  const numericId = Number(id);
  const appointment = await getAppointmentById(numericId, shopId);
  if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');
  if (shopId) {
    await run('DELETE FROM appointments WHERE id = ? AND shop_id = ?', [numericId, Number(shopId)]);
  } else {
    await run('DELETE FROM appointments WHERE id = ?', [numericId]);
  }
  return { deleted: true, id: numericId };
}

/** Cria/reaproveita o cliente pelo telefone de forma atomica (usado no agendamento publico). */
export async function upsertClientByPhone({
  name,
  phone,
  email = null,
  shopId,
  shop_id,
}: UpsertClientByPhoneInput): Promise<Client> {
  const sid = Number(shopId ?? shop_id) || 1;
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new HttpError(400, 'Informe um telefone valido.');

  const existing = await get('SELECT * FROM clients WHERE shop_id = ? AND phone = ?', [
    sid,
    digits,
  ]);
  if (existing) {
    if ((!existing['email'] || existing['email'] === '') && email) {
      await run('UPDATE clients SET email = ? WHERE id = ? AND shop_id = ?', [
        email,
        existing['id'],
        sid,
      ]);
      const refreshed = await get('SELECT * FROM clients WHERE id = ? AND shop_id = ?', [
        existing['id'],
        sid,
      ]);
      if (refreshed) return mapClientRow(refreshed);
    }
    return mapClientRow(existing);
  }

  // Nao sobrescreve o nome ja cadastrado pelo telefone no formulario publico;
  // preenche apenas campos vazios (ex.: e-mail).
  await run(
    `INSERT INTO clients (shop_id, name, phone, email) VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       email = CASE
         WHEN (clients.email IS NULL OR clients.email = '') AND excluded.email IS NOT NULL
         THEN excluded.email
         ELSE clients.email
       END`,
    [sid, name, digits, email]
  );
  const upserted = await get('SELECT * FROM clients WHERE phone = ?', [digits]);
  if (!upserted) {
    throw new HttpError(500, 'Falha ao localizar cliente apos o cadastro.');
  }
  return mapClientRow(upserted);
}
