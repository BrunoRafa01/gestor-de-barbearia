import type { ServerResponse } from 'node:http';
import {
  createAppointment,
  getAppointmentByCancelToken,
  setAppointmentStatus,
  updateAppointment,
  upsertClientByPhone,
} from '../appointments.js';
import { computeAvailability, computeAvailabilityRange } from '../availability.js';
import { addReview, all, get, getSetting, getShopBySlug, getShopReviews, run } from '../db.js';
import { isDemoMode } from '../demo.js';
import { HttpError } from '../http.js';
import {
  clientIp,
  publicBookingLimiter,
  publicReadLimiter,
  type RateLimiter,
} from '../security.js';
import { addDays, isValidDate, todayISO } from '../time.js';
import type { AppRequest, DbRow, RouteContext, RouteDefinition } from '../types.js';
import {
  digitsOnly,
  optionalEmail,
  optionalString,
  requiredDate,
  requiredId,
  requiredString,
  requiredTime,
} from '../validate.js';
import { buildMessages, waLink } from '../whatsapp.js';
import {
  notifyAppointmentCancelled,
  notifyAppointmentCreatedOrConfirmed,
  notifyAppointmentRescheduled,
} from '../whatsapp-cloud.js';

function assertPublicBookingEnabled(): void {
  if (String(getSetting('public_booking', '1')) !== '1') {
    throw new HttpError(403, 'O agendamento online esta desativado. Fale com a barbearia.');
  }
}

/** Aplica o limite por IP e responde 429 quando excedido. */
function enforceLimit(
  req: AppRequest,
  res: ServerResponse,
  limiter: RateLimiter,
  scope: string
): void {
  const limit = limiter.check(`${scope}:${clientIp(req)}`);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    throw new HttpError(429, limit.message ?? 'Muitas requisicoes. Tente novamente em instantes.');
  }
}

async function shopPayload(slug?: string | null) {
  let shopRow: DbRow | null = null;
  if (slug) {
    shopRow = await getShopBySlug(slug);
    if (!shopRow || Number(shopRow.active) === 0) {
      throw new HttpError(404, 'Barbearia nao encontrada ou indisponivel.');
    }
  }
  const defaultCuts = [
    {
      title: 'Degradê Navalhado',
      desc: 'Acabamento milimétrico na lâmina e contorno alinhado',
      tag: 'Cabelo',
    },
    {
      title: 'Barboterapia & Toalha Quente',
      desc: 'Aroma suave, hidratação profunda e lâmina afiada',
      tag: 'Barba',
    },
    {
      title: 'Corte Social Moderno',
      desc: 'Tesoura e acabamento executivo impecável',
      tag: 'Clássico',
    },
    {
      title: 'Platinado & Texturizado',
      desc: 'Descoloração segura e pomada matte',
      tag: 'Estilo',
    },
  ];

  let cuts: unknown = defaultCuts;
  if (shopRow?.cuts_gallery) {
    try {
      cuts =
        typeof shopRow.cuts_gallery === 'string'
          ? JSON.parse(shopRow.cuts_gallery)
          : shopRow.cuts_gallery;
    } catch {
      cuts = defaultCuts;
    }
  }

  const businessHours = await all(
    'SELECT weekday, is_open, open_time, close_time, break_start, break_end FROM business_hours ORDER BY weekday ASC',
    []
  );
  const closures = await all(
    'SELECT id, date, reason FROM closures WHERE date >= ? ORDER BY date ASC',
    [todayISO()]
  );

  return {
    id: shopRow?.id ? Number(shopRow.id) : 1,
    slug: shopRow?.slug ? String(shopRow.slug) : 'nova-barbearia',
    name: shopRow?.name ? String(shopRow.name) : getSetting('shop_name', 'Gestor de Barbearia'),
    company: shopRow?.company ? String(shopRow.company) : getSetting('shop_company', 'Nova Runtime'),
    description: shopRow?.description
      ? String(shopRow.description)
      : 'Cortes clássicos, barboterapia e visual contemporâneo com atendimento exclusivo e pontualidade britânica.',
    phone: shopRow?.phone ? String(shopRow.phone) : getSetting('shop_phone', ''),
    whatsapp: shopRow?.whatsapp ? String(shopRow.whatsapp) : getSetting('shop_whatsapp', ''),
    address: shopRow?.address ? String(shopRow.address) : getSetting('shop_address', ''),
    instagram: shopRow?.instagram ? String(shopRow.instagram) : getSetting('shop_instagram', ''),
    logo_url: shopRow?.logo_url ? String(shopRow.logo_url) : null,
    cover_url: shopRow?.cover_url ? String(shopRow.cover_url) : null,
    primary_color: shopRow?.primary_color ? String(shopRow.primary_color) : '#3B82F6',
    cuts_gallery: cuts,
    business_hours: businessHours.map((h) => ({
      weekday: Number(h.weekday),
      is_open: Boolean(h.is_open),
      open_time: String(h.open_time || '09:00'),
      close_time: String(h.close_time || '19:00'),
      break_start: h.break_start ? String(h.break_start) : null,
      break_end: h.break_end ? String(h.break_end) : null,
    })),
    closures: closures.map((c) => ({
      id: Number(c.id),
      date: String(c.date || ''),
      reason: c.reason ? String(c.reason) : 'Folga',
    })),
    public_booking: String(getSetting('public_booking', '1')) === '1',
    min_advance_minutes: Number(getSetting('min_advance_minutes', '0')) || 0,
    max_advance_days: Number(getSetting('max_advance_days', '60')) || 60,
    demo: isDemoMode(),
  };
}

async function activeServices(shopId = 1) {
  const rows = await all(
    'SELECT id, name, description, duration_min, price, category FROM services WHERE shop_id = ? AND active = 1 ORDER BY category ASC, name COLLATE NOCASE',
    [shopId]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    duration_min: Number(row.duration_min),
    price: Number(row.price),
    category: row.category ? String(row.category) : 'Cabelo',
  }));
}

async function activeBarbers(shopId = 1) {
  const rows = await all(
    'SELECT id, name, color, specialties, bio, rating, avatar_url FROM barbers WHERE shop_id = ? AND active = 1 ORDER BY name COLLATE NOCASE',
    [shopId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name || ''),
    color: row.color ? String(row.color) : null,
    specialties: row.specialties ? String(row.specialties) : 'Degradê, Barba, Tesoura',
    bio: row.bio ? String(row.bio) : 'Mestre barbeiro com foco em visagismo e pontualidade.',
    rating: Number(row.rating || 4.9),
    avatar_url: row.avatar_url ? String(row.avatar_url) : '',
  }));
}

export const publicRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/public/config',
    auth: false,
    handler: async ({ req, res, query }: RouteContext) => {
      enforceLimit(req, res, publicReadLimiter, 'public-config');
      const shopSlug = query?.shop || 'nova-barbearia';
      const shop = await shopPayload(shopSlug);
      const shopId = Number(shop?.id) || 1;
      const [services, barbers, reviews] = await Promise.all([
        activeServices(shopId),
        activeBarbers(shopId),
        getShopReviews(shopSlug),
      ]);
      return { status: 200, body: { shop, services, barbers, reviews } };
    },
  },
  {
    method: 'GET',
    path: '/api/public/availability',
    auth: false,
    handler: async ({ req, res, query }: RouteContext) => {
      enforceLimit(req, res, publicReadLimiter, 'public-availability');
      assertPublicBookingEnabled();

      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const date = query.date && isValidDate(query.date) ? query.date : todayISO();

      const shop = await shopPayload(query.shop);
      const maxDate = addDays(todayISO(), (Number(shop.max_advance_days) || 45) + 1);
      if (date > maxDate) {
        return {
          status: 200,
          body: { open: false, slots: [], reason: 'Data muito distante.', date },
        };
      }

      const result = (await computeAvailability({ barberId, serviceId, date })) ?? {
        open: false,
        slots: [] as string[],
        reason: null as string | null,
        duration: 0,
        price: 0,
      };
      return { status: 200, body: { ...result, date } };
    },
  },
  {
    method: 'GET',
    path: '/api/public/calendar',
    auth: false,
    handler: async ({ req, res, query }: RouteContext) => {
      enforceLimit(req, res, publicReadLimiter, 'public-calendar');
      assertPublicBookingEnabled();

      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const from = query.from && isValidDate(query.from) ? query.from : todayISO();
      const to = query.to && isValidDate(query.to) ? query.to : addDays(from, 30);

      const dates: string[] = [];
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
          const day = map.get(date) ?? { open: false, slots: [] as string[], reason: null };
          return { date, open: day.open, slots: day.slots.length, reason: day.reason };
        }),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/public/appointments',
    auth: false,
    handler: async ({ req, res, body }: RouteContext) => {
      enforceLimit(req, res, publicBookingLimiter, 'public-booking');
      assertPublicBookingEnabled();

      const shop = await shopPayload(optionalString(body.shop, 'barbearia', 80));
      const targetShopId = Number(shop.id) || 1;
      const barberId = requiredId(body.barber_id, 'profissional');
      const serviceId = requiredId(body.service_id, 'servico');

      const [barberRow, serviceRow] = await Promise.all([
        get('SELECT id FROM barbers WHERE id = ? AND shop_id = ?', [barberId, targetShopId]),
        get('SELECT id FROM services WHERE id = ? AND shop_id = ?', [serviceId, targetShopId]),
      ]);
      if (!barberRow) throw new HttpError(400, 'Profissional nao pertence a esta barbearia.');
      if (!serviceRow) throw new HttpError(400, 'Servico nao pertence a esta barbearia.');

      const name = requiredString(body.name, 'seu nome', { max: 120 });
      const phone = digitsOnly(requiredString(body.phone, 'WhatsApp'));
      if (phone.length < 10 || phone.length > 11) {
        throw new HttpError(400, 'Informe um WhatsApp com DDD (10 ou 11 digitos).');
      }
      const email = optionalEmail(body.email);
      const notes = optionalString(body.notes, 'observacoes', 300);

      const client = await upsertClientByPhone({ name, phone, email, shopId: targetShopId });
      if (!client) throw new HttpError(500, 'Falha ao registrar cliente.');

      const appointment = await createAppointment({
        shop_id: targetShopId,
        client_id: Number(client.id),
        barber_id: barberId,
        service_id: serviceId,
        date: requiredDate(body.date),
        start_time: requiredTime(body.start_time, 'horario'),
        notes,
        source: 'public',
        status: 'pending',
      });
      if (!appointment) throw new HttpError(500, 'Falha ao carregar agendamento criado.');

      const messages = buildMessages({
        ...appointment,
        shop_name: shop.name || getSetting('shop_name', 'Gestor de Barbearia'),
      });

      let whatsappDelivery: Awaited<ReturnType<typeof notifyAppointmentCreatedOrConfirmed>> | null =
        null;
      try {
        whatsappDelivery = await notifyAppointmentCreatedOrConfirmed(appointment);
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao disparar notificação pública:', err);
      }

      const clientPhone = appointment.client_phone ?? '';

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
            link: waLink(clientPhone, messages.confirmation),
            whatsapp_automated: Boolean(whatsappDelivery?.client?.success),
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
    handler: async ({ req, res, params }: RouteContext) => {
      enforceLimit(req, res, publicReadLimiter, 'public-appointment-lookup');
      const token = String(params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        throw new HttpError(400, 'Código de agendamento inválido.');
      }

      const appointment = await getAppointmentByCancelToken(token);
      if (!appointment) {
        throw new HttpError(404, 'Agendamento não encontrado ou link expirado.');
      }
      if (todayISO() > addDays(appointment.date, 7)) {
        throw new HttpError(
          410,
          'Este link de gerenciamento expirou. Entre em contato com a barbearia.'
        );
      }

      return {
        status: 200,
        body: {
          id: appointment.id,
          date: appointment.date,
          start_time: appointment.start_time,
          end_time: appointment.end_time,
          status: appointment.status,
          service_id: appointment.service_id,
          service_name: appointment.service_name,
          service_duration: appointment.service_duration,
          barber_id: appointment.barber_id,
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
    handler: async ({ req, res, params, body }: RouteContext) => {
      enforceLimit(req, res, publicBookingLimiter, 'public-appointment-cancel');
      const token = String(params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        throw new HttpError(400, 'Código de agendamento inválido.');
      }

      const appointment = await getAppointmentByCancelToken(token);
      if (!appointment) {
        throw new HttpError(404, 'Agendamento não encontrado ou link expirado.');
      }
      if (todayISO() > addDays(appointment.date, 7)) {
        throw new HttpError(
          410,
          'Este link de gerenciamento expirou. Entre em contato com a barbearia.'
        );
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

      if (appointment.status === 'completed' || appointment.status === 'no_show') {
        throw new HttpError(
          409,
          'Agendamentos concluídos ou marcados como falta não podem ser cancelados.'
        );
      }

      const reason = optionalString(body?.reason, 'motivo', 300);
      const updated = await setAppointmentStatus(appointment.id, 'cancelled');
      if (!updated) throw new HttpError(404, 'Agendamento não encontrado.');
      if (reason) {
        const newNotes = appointment.notes
          ? `${appointment.notes} | Motivo do cancelamento: ${reason}`
          : `Motivo do cancelamento: ${reason}`;
        await run('UPDATE appointments SET notes = ? WHERE id = ?', [newNotes, appointment.id]);
      }

      try {
        await notifyAppointmentCancelled(appointment, reason ?? '');
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
    method: 'POST',
    path: '/api/public/appointments/:token/reschedule',
    auth: false,
    handler: async ({ req, res, params, body }: RouteContext) => {
      enforceLimit(req, res, publicBookingLimiter, 'public-appointment-reschedule');
      assertPublicBookingEnabled();

      const token = String(params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        throw new HttpError(400, 'Código de agendamento inválido.');
      }

      const appointment = await getAppointmentByCancelToken(token);
      if (!appointment) {
        throw new HttpError(404, 'Agendamento não encontrado ou link expirado.');
      }
      if (todayISO() > addDays(appointment.date, 7)) {
        throw new HttpError(
          410,
          'Este link de gerenciamento expirou. Entre em contato com a barbearia.'
        );
      }
      if (['cancelled', 'completed', 'no_show'].includes(appointment.status)) {
        throw new HttpError(409, 'Este agendamento não pode mais ser reagendado online.');
      }

      const date = requiredDate(body?.date);
      const startTime = requiredTime(body?.start_time, 'horario');
      const barberId = body?.barber_id
        ? requiredId(body.barber_id, 'profissional')
        : appointment.barber_id;
      const maxDays = Math.max(1, Number(getSetting('max_advance_days', '30')) || 30);
      if (date > addDays(todayISO(), maxDays)) {
        throw new HttpError(400, `Agendamentos disponiveis apenas para os proximos ${maxDays} dias.`);
      }

      const updated = await updateAppointment(appointment.id, {
        date,
        start_time: startTime,
        barber_id: barberId,
      });
      if (!updated) throw new HttpError(404, 'Agendamento não encontrado.');

      try {
        await notifyAppointmentRescheduled(updated, appointment.date, appointment.start_time);
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao disparar reagendamento público:', err);
      }

      return {
        status: 200,
        body: {
          rescheduled: true,
          message: 'Seu agendamento foi reagendado com sucesso.',
          appointment: updated,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/public/shops',
    auth: false,
    handler: async ({ req, res }: RouteContext) => {
      enforceLimit(req, res, publicReadLimiter, 'public-shops');
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
    handler: async ({ req, res, query }: RouteContext) => {
      enforceLimit(req, res, publicReadLimiter, 'public-reviews');
      const shopSlug = query?.shop || 'nova-barbearia';
      const reviews = await getShopReviews(shopSlug);
      return { status: 200, body: reviews };
    },
  },
  {
    method: 'POST',
    path: '/api/public/reviews',
    auth: false,
    handler: async ({ req, res, body }: RouteContext) => {
      enforceLimit(req, res, publicBookingLimiter, 'public-review-create');
      const shopSlug = typeof body?.shop_slug === 'string' && body.shop_slug ? body.shop_slug : 'nova-barbearia';
      const clientName = requiredString(body?.client_name, 'seu nome', { max: 100 });
      const rating = Number(body?.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new HttpError(400, 'A nota da avaliação deve ser um inteiro entre 1 e 5 estrelas.');
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
    handler: async ({ res, params }: RouteContext) => {
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
      const nowClean = (new Date().toISOString().replace(/[-:]/g, '').split('.')[0] ?? '') + 'Z';

      const escIcs = (value: unknown): string =>
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
      return null;
    },
  },
];
