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

import { all, get, run } from './db.js';
import { HttpError } from './http.js';
import { assertSlotAvailable, endTimeFor } from './availability.js';
import {
  optionalString,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredTime,
} from './validate.js';
import { ACTIVE_STATUSES, isValidStatus } from './time.js';

const APPOINTMENT_SELECT = `
  SELECT a.id, a.client_id, a.barber_id, a.service_id, a.date, a.start_time, a.end_time,
         a.status, a.price, a.notes, a.source, a.created_at, a.updated_at,
         c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
         b.name AS barber_name, b.color AS barber_color,
         s.name AS service_name, s.duration_min AS service_duration
  FROM appointments a
  JOIN clients  c ON c.id = a.client_id
  JOIN barbers  b ON b.id = a.barber_id
  LEFT JOIN services s ON s.id = a.service_id
`;

const ACTIVE_SQL = ACTIVE_STATUSES.map((status) => `'${status}'`).join(',');

function mapRow(row) {
  if (!row) return null;
  return { ...row, id: Number(row.id), price: Number(row.price || 0) };
}

export async function getAppointmentById(id) {
  const row = await get(`${APPOINTMENT_SELECT} WHERE a.id = ?`, [Number(id)]);
  return mapRow(row);
}

export async function listAppointments(filters = {}) {
  const where = [];
  const params = [];

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
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR s.name LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  const sql = `${APPOINTMENT_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.date DESC, a.start_time DESC`;

  const rows = await all(sql, params);
  return rows.map(mapRow);
}

async function loadService(serviceId) {
  const service = await get('SELECT * FROM services WHERE id = ?', [serviceId]);
  if (!service) throw new HttpError(404, 'Servico nao encontrado.');
  return service;
}

async function loadBarber(barberId) {
  const barber = await get('SELECT * FROM barbers WHERE id = ?', [barberId]);
  if (!barber) throw new HttpError(404, 'Profissional nao encontrado.');
  return barber;
}

async function loadClient(clientId) {
  const client = await get('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) throw new HttpError(404, 'Cliente nao encontrado.');
  return client;
}

/**
 * Insere o agendamento somente se o intervalo estiver livre.
 * Retorna `null` quando houve conflito (outra requisicao gravou no meio).
 */
async function insertIfFree({
  clientId,
  barberId,
  serviceId,
  date,
  startTime,
  endTime,
  status,
  price,
  notes,
  source,
}) {
  const info = await run(
    `INSERT INTO appointments
       (client_id, barber_id, service_id, date, start_time, end_time, status, price, notes, source)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.barber_id = ?
           AND a.date = ?
           AND a.status IN (${ACTIVE_SQL})
           AND a.start_time < ?
           AND a.end_time   > ?
      )`,
    [
      clientId, barberId, serviceId, date, startTime, endTime, status, price, notes, source,
      barberId, date, endTime, startTime,
    ]
  );
  return info.changes > 0 ? Number(info.lastInsertRowid) : null;
}

export async function createAppointment(input, now = new Date()) {
  const clientId = requiredId(input.client_id, 'cliente');
  const barberId = requiredId(input.barber_id, 'profissional');
  const serviceId = requiredId(input.service_id, 'servico');
  const date = requiredDate(input.date);
  const startTime = requiredTime(input.start_time, 'horario');
  const status = input.status
    ? requiredEnum(String(input.status), ['pending', 'confirmed', 'completed'], 'status')
    : 'pending';
  const source = input.source === 'public' ? 'public' : 'admin';
  const notes = optionalString(input.notes, 'observacoes', 500);

  await Promise.all([loadClient(clientId), loadBarber(barberId)]);

  const availability = await assertSlotAvailable({ barberId, serviceId, date, startTime, now });
  const endTime = endTimeFor(startTime, availability.duration);
  const price =
    input.price === undefined || input.price === null || input.price === ''
      ? availability.price
      : Number(input.price);

  const id = await insertIfFree({
    clientId,
    barberId,
    serviceId,
    date,
    startTime,
    endTime,
    status,
    price,
    notes,
    source,
  });

  if (id === null) {
    throw new HttpError(409, 'Este horario acabou de ser reservado. Escolha outro horario livre.');
  }

  return getAppointmentById(id);
}

export async function updateAppointment(id, input, now = new Date()) {
  const appointmentId = Number(id);
  const current = await getAppointmentById(appointmentId);
  if (!current) throw new HttpError(404, 'Agendamento nao encontrado.');

  const clientId = input.client_id ? requiredId(input.client_id, 'cliente') : current.client_id;
  const barberId = input.barber_id ? requiredId(input.barber_id, 'profissional') : current.barber_id;
  const serviceId = input.service_id ? requiredId(input.service_id, 'servico') : current.service_id;
  const date = input.date ? requiredDate(input.date) : current.date;
  const startTime = input.start_time
    ? requiredTime(input.start_time, 'horario')
    : current.start_time;
  const status = input.status
    ? requiredEnum(
        String(input.status),
        ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'],
        'status'
      )
    : current.status;
  const notes =
    input.notes === undefined ? current.notes : optionalString(input.notes, 'observacoes', 500);

  await loadClient(clientId);
  const service = await loadService(serviceId);
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
  const price =
    input.price === undefined || input.price === null || input.price === ''
      ? Number(service.price)
      : Number(input.price);

  await run(
    `UPDATE appointments
        SET client_id = ?, barber_id = ?, service_id = ?, date = ?, start_time = ?, end_time = ?,
            status = ?, price = ?, notes = ?, updated_at = datetime('now','localtime')
      WHERE id = ?`,
    [clientId, barberId, serviceId, date, startTime, endTime, status, price, notes, appointmentId]
  );

  return getAppointmentById(appointmentId);
}

export async function setAppointmentStatus(id, status) {
  const appointmentId = Number(id);
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');

  const nextStatus = requiredEnum(
    String(status),
    ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'],
    'status'
  );

  if (appointment.status === nextStatus) return appointment;

  // Ao reativar um agendamento cancelado, o horario precisa estar livre novamente.
  if (ACTIVE_STATUSES.includes(nextStatus)) {
    await assertSlotAvailable({
      barberId: appointment.barber_id,
      serviceId: appointment.service_id,
      date: appointment.date,
      startTime: appointment.start_time,
      excludeId: appointmentId,
    });
  }

  await run(
    `UPDATE appointments SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [nextStatus, appointmentId]
  );

  return getAppointmentById(appointmentId);
}

export async function deleteAppointment(id) {
  const appointment = await getAppointmentById(id);
  if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');
  await run('DELETE FROM appointments WHERE id = ?', [Number(id)]);
  return { deleted: true, id: Number(id) };
}

/** Cria/reaproveita o cliente pelo telefone (usado no agendamento publico). */
export async function upsertClientByPhone({ name, phone, email = null }) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) throw new HttpError(400, 'Informe um telefone valido.');

  const existing = await get('SELECT * FROM clients WHERE phone = ?', [digits]);
  if (existing) {
    await run('UPDATE clients SET name = ? WHERE id = ?', [name, existing.id]);
    return get('SELECT * FROM clients WHERE id = ?', [existing.id]);
  }

  const info = await run('INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)', [
    name,
    digits,
    email,
  ]);
  return get('SELECT * FROM clients WHERE id = ?', [Number(info.lastInsertRowid)]);
}
