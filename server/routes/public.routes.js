import { computeAvailability, computeAvailabilityRange } from '../availability.js';
import {
  createAppointment,
  getAppointmentByCancelToken,
  setAppointmentStatus,
  upsertClientByPhone,
} from '../appointments.js';
import { all, getSetting, run } from '../db.js';
import { isDemoMode } from '../demo.js';
import { HttpError } from '../http.js';
import { clientIp, publicBookingLimiter, publicReadLimiter } from '../security.js';
import { buildMessages, waLink } from '../whatsapp.js';
import { addDays, isValidDate, todayISO } from '../time.js';
import {
  digitsOnly,
  optionalEmail,
  optionalString,
  requiredDate,
  requiredId,
  requiredString,
  requiredTime,
} from '../validate.js';

function assertPublicBookingEnabled() {
  if (String(getSetting('public_booking', '1')) !== '1') {
    throw new HttpError(403, 'O agendamento online esta desativado. Fale com a barbearia.');
  }
}

/** Aplica o limite por IP e responde 429 quando excedido. */
function enforceLimit(req, res, limiter, scope) {
  const limit = limiter.check(`${scope}:${clientIp(req)}`);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    throw new HttpError(429, limit.message);
  }
}

function shopPayload() {
  return {
    name: getSetting('shop_name', 'Gestor de Barbearia'),
    company: getSetting('shop_company', 'Nova Runtime'),
    phone: getSetting('shop_phone', ''),
    whatsapp: getSetting('shop_whatsapp', ''),
    address: getSetting('shop_address', ''),
    instagram: getSetting('shop_instagram', ''),
    public_booking: String(getSetting('public_booking', '1')) === '1',
    min_advance_minutes: Number(getSetting('min_advance_minutes', '0')) || 0,
    max_advance_days: Number(getSetting('max_advance_days', '60')) || 60,
    demo: isDemoMode(),
  };
}

async function activeServices() {
  const rows = await all(
    'SELECT id, name, description, duration_min, price FROM services WHERE active = 1 ORDER BY name COLLATE NOCASE',
    []
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    duration_min: Number(row.duration_min),
    price: Number(row.price),
  }));
}

async function activeBarbers() {
  const rows = await all(
    'SELECT id, name, color FROM barbers WHERE active = 1 ORDER BY name COLLATE NOCASE',
    []
  );
  return rows.map((row) => ({ id: Number(row.id), name: row.name, color: row.color }));
}

export const publicRoutes = [
  {
    method: 'GET',
    path: '/api/public/config',
    auth: false,
    handler: async () => {
      const [services, barbers] = await Promise.all([activeServices(), activeBarbers()]);
      return { status: 200, body: { shop: shopPayload(), services, barbers } };
    },
  },
  {
    method: 'GET',
    path: '/api/public/availability',
    auth: false,
    handler: async ({ req, res, query }) => {
      enforceLimit(req, res, publicReadLimiter, 'public-availability');
      assertPublicBookingEnabled();

      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const date = isValidDate(query.date) ? query.date : todayISO();

      const shop = shopPayload();
      const maxDate = addDays(todayISO(), shop.max_advance_days + 1);
      if (date > maxDate) {
        return {
          status: 200,
          body: { open: false, slots: [], reason: 'Data muito distante.', date },
        };
      }

      const result = await computeAvailability({ barberId, serviceId, date });
      return { status: 200, body: { ...result, date } };
    },
  },
  {
    method: 'GET',
    path: '/api/public/calendar',
    auth: false,
    handler: async ({ req, res, query }) => {
      enforceLimit(req, res, publicReadLimiter, 'public-calendar');
      assertPublicBookingEnabled();

      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const from = isValidDate(query.from) ? query.from : todayISO();
      const to = isValidDate(query.to) ? query.to : addDays(from, 30);

      const dates = [];
      let cursor = from;
      let guard = 0;
      while (cursor <= to && guard < 120) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
        guard += 1;
      }

      const map = await computeAvailabilityRange({ barberId, serviceId, dates });

      return {
        status: 200,
        body: dates.map((date) => {
          const day = map.get(date) || { open: false, slots: [], reason: null };
          return { date, open: day.open, slots: day.slots.length, reason: day.reason };
        }),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/public/appointments',
    auth: false,
    handler: async ({ req, res, body }) => {
      enforceLimit(req, res, publicBookingLimiter, 'public-booking');
      assertPublicBookingEnabled();

      const name = requiredString(body.name, 'seu nome', { max: 120 });
      const phone = digitsOnly(requiredString(body.phone, 'WhatsApp'));
      if (phone.length < 10 || phone.length > 11) {
        throw new HttpError(400, 'Informe um WhatsApp com DDD (10 ou 11 digitos).');
      }
      const email = optionalEmail(body.email);
      const notes = optionalString(body.notes, 'observacoes', 300);

      const client = await upsertClientByPhone({ name, phone, email });

      const appointment = await createAppointment({
        client_id: client.id,
        barber_id: requiredId(body.barber_id, 'profissional'),
        service_id: requiredId(body.service_id, 'servico'),
        date: requiredDate(body.date),
        start_time: requiredTime(body.start_time, 'horario'),
        notes,
        source: 'public',
        status: 'pending',
      });

      const messages = buildMessages({
        ...appointment,
        shop_name: getSetting('shop_name', 'Gestor de Barbearia'),
      });

      return {
        status: 201,
        body: {
          appointment,
          cancel_token: appointment.cancel_token || null,
          manage_url: appointment.cancel_token
            ? `/agendar?manage=${appointment.cancel_token}`
            : null,
          confirmation: {
            phone: appointment.client_phone,
            message: messages.confirmation,
            link: waLink(appointment.client_phone, messages.confirmation),
          },
          shop: shopPayload(),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/public/appointments/:token',
    auth: false,
    handler: async ({ req, res, params }) => {
      enforceLimit(req, res, publicReadLimiter, 'public-appointment-lookup');
      const token = String(params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        throw new HttpError(400, 'Código de agendamento inválido.');
      }

      const appointment = await getAppointmentByCancelToken(token);
      if (!appointment) {
        throw new HttpError(404, 'Agendamento não encontrado ou link expirado.');
      }

      return {
        status: 200,
        body: {
          id: appointment.id,
          date: appointment.date,
          start_time: appointment.start_time,
          end_time: appointment.end_time,
          status: appointment.status,
          service_name: appointment.service_name,
          service_duration: appointment.service_duration,
          barber_name: appointment.barber_name,
          barber_color: appointment.barber_color,
          price: appointment.price,
          client_name: appointment.client_name,
          notes: appointment.notes,
          shop: shopPayload(),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/public/appointments/:token/cancel',
    auth: false,
    handler: async ({ req, res, params, body }) => {
      enforceLimit(req, res, publicBookingLimiter, 'public-appointment-cancel');
      const token = String(params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        throw new HttpError(400, 'Código de agendamento inválido.');
      }

      const appointment = await getAppointmentByCancelToken(token);
      if (!appointment) {
        throw new HttpError(404, 'Agendamento não encontrado ou link expirado.');
      }

      if (appointment.status === 'cancelled') {
        return {
          status: 200,
          body: {
            cancelled: true,
            message: 'Este agendamento já estava cancelado.',
            appointment,
          },
        };
      }

      if (appointment.status === 'completed') {
        throw new HttpError(400, 'Agendamentos já concluídos não podem ser cancelados.');
      }

      const reason = optionalString(body?.reason, 'motivo', 300);
      const updated = await setAppointmentStatus(appointment.id, 'cancelled');
      if (reason) {
        const newNotes = appointment.notes
          ? `${appointment.notes} | Motivo do cancelamento: ${reason}`
          : `Motivo do cancelamento: ${reason}`;
        await run('UPDATE appointments SET notes = ? WHERE id = ?', [newNotes, appointment.id]);
      }

      return {
        status: 200,
        body: {
          cancelled: true,
          message: 'Seu agendamento foi cancelado com sucesso.',
          reason: reason || null,
          appointment: {
            id: updated.id,
            date: updated.date,
            start_time: updated.start_time,
            status: 'cancelled',
            cancellation_reason: reason || null,
          },
        },
      };
    },
  },
];
