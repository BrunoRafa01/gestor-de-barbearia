import { computeAvailability, computeAvailabilityRange } from '../availability.js';
import {
  createAppointment,
  getAppointmentByCancelToken,
  setAppointmentStatus,
  upsertClientByPhone,
} from '../appointments.js';
import { all, get, getSetting, getShopBySlug, getShopReviews, addReview, run } from '../db.js';
import { isDemoMode } from '../demo.js';
import { HttpError } from '../http.js';
import { clientIp, publicBookingLimiter, publicReadLimiter } from '../security.js';
import { buildMessages, waLink } from '../whatsapp.js';
import {
  notifyAppointmentCancelled,
  notifyAppointmentCreatedOrConfirmed,
} from '../whatsapp-cloud.js';
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

async function shopPayload(slug) {
  let shopRow = null;
  if (slug) {
    shopRow = await getShopBySlug(slug);
  }
  const defaultCuts = [
    { title: 'Degradê Navalhado', desc: 'Acabamento milimétrico na lâmina e contorno alinhado', tag: 'Cabelo' },
    { title: 'Barboterapia & Toalha Quente', desc: 'Aroma suave, hidratação profunda e lâmina afiada', tag: 'Barba' },
    { title: 'Corte Social Moderno', desc: 'Tesoura e acabamento executivo impecável', tag: 'Clássico' },
    { title: 'Platinado & Texturizado', desc: 'Descoloração segura e pomada matte', tag: 'Estilo' },
  ];

  let cuts = defaultCuts;
  if (shopRow?.cuts_gallery) {
    try {
      cuts = typeof shopRow.cuts_gallery === 'string' ? JSON.parse(shopRow.cuts_gallery) : shopRow.cuts_gallery;
    } catch {
      cuts = defaultCuts;
    }
  }

  return {
    slug: shopRow?.slug || 'nova-barbearia',
    name: shopRow?.name || getSetting('shop_name', 'Gestor de Barbearia'),
    company: shopRow?.company || getSetting('shop_company', 'Nova Runtime'),
    description: shopRow?.description || 'Cortes clássicos, barboterapia e visual contemporâneo com atendimento exclusivo e pontualidade britânica.',
    phone: shopRow?.phone || getSetting('shop_phone', ''),
    whatsapp: shopRow?.whatsapp || getSetting('shop_whatsapp', ''),
    address: shopRow?.address || getSetting('shop_address', ''),
    instagram: shopRow?.instagram || getSetting('shop_instagram', ''),
    logo_url: shopRow?.logo_url || null,
    cover_url: shopRow?.cover_url || null,
    primary_color: shopRow?.primary_color || '#3B82F6',
    cuts_gallery: cuts,
    public_booking: String(getSetting('public_booking', '1')) === '1',
    min_advance_minutes: Number(getSetting('min_advance_minutes', '0')) || 0,
    max_advance_days: Number(getSetting('max_advance_days', '60')) || 60,
    demo: isDemoMode(),
  };
}

async function activeServices() {
  const rows = await all(
    'SELECT id, name, description, duration_min, price, category FROM services WHERE active = 1 ORDER BY category ASC, name COLLATE NOCASE',
    []
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    duration_min: Number(row.duration_min),
    price: Number(row.price),
    category: row.category || 'Cabelo',
  }));
}

async function activeBarbers() {
  const rows = await all(
    'SELECT id, name, color, specialties, bio, rating, avatar_url FROM barbers WHERE active = 1 ORDER BY name COLLATE NOCASE',
    []
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    color: row.color,
    specialties: row.specialties || 'Degradê, Barba, Tesoura',
    bio: row.bio || 'Mestre barbeiro com foco em visagismo e pontualidade.',
    rating: Number(row.rating || 4.9),
    avatar_url: row.avatar_url || '',
  }));
}

export const publicRoutes = [
  {
    method: 'GET',
    path: '/api/public/config',
    auth: false,
    handler: async ({ query }) => {
      const shopSlug = query?.shop || 'nova-barbearia';
      const [shop, services, barbers, reviews] = await Promise.all([
        shopPayload(shopSlug),
        activeServices(),
        activeBarbers(),
        getShopReviews(shopSlug),
      ]);
      return { status: 200, body: { shop, services, barbers, reviews } };
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

      const shop = await shopPayload(query.shop);
      const maxDate = addDays(todayISO(), (Number(shop.max_advance_days) || 45) + 1);
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

      let whatsappDelivery = null;
      try {
        whatsappDelivery = await notifyAppointmentCreatedOrConfirmed(appointment);
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao disparar notificação pública:', err);
      }

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
            whatsapp_automated: Boolean(whatsappDelivery?.clientResult?.success),
          },
          whatsapp: whatsappDelivery,
          shop: await shopPayload(),
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
          shop: await shopPayload(),
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

      try {
        await notifyAppointmentCancelled(appointment, reason);
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao disparar cancelamento público:', err);
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
  {
    method: 'GET',
    path: '/api/public/shops',
    auth: false,
    handler: async () => {
      const rows = await all(
        'SELECT id, slug, name, company, description, logo_url, phone, whatsapp, address, instagram, primary_color FROM barbershops WHERE active = 1 ORDER BY name ASC',
        []
      );
      return { status: 200, body: rows };
    },
  },
  {
    method: 'GET',
    path: '/api/public/reviews',
    auth: false,
    handler: async ({ query }) => {
      const shopSlug = query?.shop || 'nova-barbearia';
      const reviews = await getShopReviews(shopSlug);
      return { status: 200, body: reviews };
    },
  },
  {
    method: 'POST',
    path: '/api/public/reviews',
    auth: false,
    handler: async ({ req, res, body }) => {
      enforceLimit(req, res, publicBookingLimiter, 'public-review-create');
      const shopSlug = body?.shop_slug || 'nova-barbearia';
      const clientName = requiredString(body?.client_name, 'seu nome', { max: 100 });
      const rating = Number(body?.rating);
      if (!rating || rating < 1 || rating > 5) {
        throw new HttpError(400, 'A nota da avaliação deve ser entre 1 e 5 estrelas.');
      }
      const comment = optionalString(body?.comment, 'comentário', 500);
      const appointmentId = body?.appointment_id ? Number(body.appointment_id) : null;
      const barberId = body?.barber_id ? Number(body.barber_id) : null;

      await addReview({ shopSlug, clientName, rating, comment, appointmentId, barberId });
      return {
        status: 201,
        body: { success: true, message: 'Obrigado por avaliar nosso atendimento!' },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/public/ics/:token',
    auth: false,
    handler: async ({ req, res, params }) => {
      const token = String(params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        throw new HttpError(400, 'Código inválido.');
      }
      const appt = await getAppointmentByCancelToken(token);
      if (!appt) {
        throw new HttpError(404, 'Agendamento não localizado.');
      }

      const shopName = getSetting('shop_name', 'Nova Barbearia');
      const shopAddress = getSetting('shop_address', 'Av. Modelo, 100 - Cidade Fictícia - SP');
      const dClean = appt.date.replace(/-/g, '');
      const sClean = appt.start_time.replace(/:/g, '') + '00';
      const eClean = (appt.end_time || appt.start_time).replace(/:/g, '') + '00';
      const nowClean = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

      const escIcs = (value) =>
        String(value || '')
          .replace(/[\r\n]+/g, ' ')
          .replace(/\\/g, '\\\\')
          .replace(/;/g, '\\;')
          .replace(/,/g, '\\,');

      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Nova Runtime//Gestor de Barbearia//PT',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:appt-${appt.id}-${Date.now()}@novaruntime.com.br`,
        `DTSTAMP:${nowClean}`,
        `DTSTART:${dClean}T${sClean}`,
        `DTEND:${dClean}T${eClean}`,
        `SUMMARY:${escIcs(appt.service_name)} com ${escIcs(appt.barber_name)} | ${escIcs(shopName)}`,
        `DESCRIPTION:Agendamento confirmado de ${escIcs(appt.service_name)} na ${escIcs(shopName)}.`,
        `LOCATION:${escIcs(shopAddress)}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="agendamento-${appt.date}.ics"`,
        'Content-Length': Buffer.byteLength(ics, 'utf-8'),
      });
      res.end(ics);
    },
  },
];
