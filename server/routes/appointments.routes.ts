import { computeAvailability, computeAvailabilityRange } from '../availability.js';
import {
  createAppointment,
  deleteAppointment,
  getAppointmentById,
  listAppointments,
  setAppointmentStatus,
  updateAppointment,
} from '../appointments.js';
import { getSetting } from '../db.js';
import { HttpError } from '../http.js';
import { addDays, isValidDate, todayISO } from '../time.js';
import type { RouteContext, RouteDefinition } from '../types.js';
import { optionalId, requiredId } from '../validate.js';
import { buildMessages, waLink } from '../whatsapp.js';
import {
  notifyAppointmentCancelled,
  notifyAppointmentCreatedOrConfirmed,
  notifyAppointmentRescheduled,
} from '../whatsapp-cloud.js';

type MessageKind = 'confirmation' | 'reminder' | 'cancellation';

export const appointmentRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/appointments',
    handler: async ({ query, shopId = 1 }: RouteContext) => {
      const filters: {
        shopId: number;
        from?: string;
        to?: string;
        barberId?: string;
        clientId?: string;
        status?: string;
        search?: string;
      } = {
        shopId,
        from: query.from,
        to: query.to,
        barberId: query.barber_id,
        clientId: query.client_id,
        status: query.status,
        search: query.search,
      };
      if (query.date) {
        filters.from = query.date;
        filters.to = query.date;
      }
      return { status: 200, body: await listAppointments(filters) };
    },
  },
  {
    method: 'GET',
    path: '/api/appointments/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const appointment = await getAppointmentById(requiredId(params.id, 'agendamento'), shopId);
      if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');
      return { status: 200, body: appointment };
    },
  },
  {
    method: 'GET',
    path: '/api/appointments/:id/whatsapp',
    handler: async ({ params, query, shopId = 1 }: RouteContext) => {
      const appointment = await getAppointmentById(requiredId(params.id, 'agendamento'), shopId);
      if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');

      const messages = buildMessages({
        ...appointment,
        shop_name: getSetting('shop_name', 'Gestor de Barbearia') ?? 'Gestor de Barbearia',
      });

      const rawType = query.type;
      const type: MessageKind =
        rawType === 'confirmation' || rawType === 'reminder' || rawType === 'cancellation'
          ? rawType
          : 'confirmation';
      const message = messages[type];
      const clientPhone = appointment.client_phone ?? '';

      return {
        status: 200,
        body: {
          type,
          phone: appointment.client_phone,
          message,
          link: waLink(clientPhone, message),
          all: {
            confirmation: messages.confirmation,
            reminder: messages.reminder,
            cancellation: messages.cancellation,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/appointments',
    handler: async ({ body, shopId = 1 }: RouteContext) => {
      const created = await createAppointment({ ...body, shop_id: shopId, source: 'admin' });
      if (!created) throw new HttpError(500, 'Falha ao carregar agendamento criado.');
      try {
        await notifyAppointmentCreatedOrConfirmed(created);
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao notificar criacao pelo painel:', err);
      }
      return {
        status: 201,
        body: created,
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/appointments/:id',
    handler: async ({ params, body, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'agendamento');
      const existing = await getAppointmentById(id, shopId);
      const updated = await updateAppointment(id, body, new Date(), { shopId });
      if (!updated) throw new HttpError(404, 'Agendamento nao encontrado.');

      try {
        if (existing && (existing.date !== updated.date || existing.start_time !== updated.start_time)) {
          await notifyAppointmentRescheduled(updated, existing.date, existing.start_time);
        } else if (existing && existing.status !== updated.status) {
          if (updated.status === 'cancelled') {
            await notifyAppointmentCancelled(updated, 'Status alterado para cancelado');
          } else if (updated.status === 'confirmed') {
            await notifyAppointmentCreatedOrConfirmed(updated);
          }
        }
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao notificar alteracao de agendamento:', err);
      }

      return {
        status: 200,
        body: updated,
      };
    },
  },
  {
    method: 'PATCH',
    path: '/api/appointments/:id/status',
    handler: async ({ params, body, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'agendamento');
      const updated = await setAppointmentStatus(id, String(body.status ?? ''), { shopId });
      if (!updated) throw new HttpError(404, 'Agendamento nao encontrado.');

      try {
        if (body.status === 'cancelled') {
          await notifyAppointmentCancelled(updated, 'Status atualizado para cancelado');
        } else if (body.status === 'confirmed') {
          await notifyAppointmentCreatedOrConfirmed(updated);
        }
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao notificar status de agendamento:', err);
      }

      return {
        status: 200,
        body: updated,
      };
    },
  },
  {
    method: 'DELETE',
    path: '/api/appointments/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const id = requiredId(params.id, 'agendamento');
      const existing = await getAppointmentById(id, shopId);
      const result = await deleteAppointment(id, { shopId });

      try {
        if (existing && existing.status !== 'cancelled') {
          await notifyAppointmentCancelled(existing, 'Agendamento removido pelo administrador');
        }
      } catch (err) {
        console.error('[WhatsApp Cloud] Erro ao notificar remocao de agendamento:', err);
      }

      return {
        status: 200,
        body: result,
      };
    },
  },
  {
    method: 'GET',
    path: '/api/availability',
    handler: async ({ query }: RouteContext) => {
      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const date = query.date && isValidDate(query.date) ? query.date : todayISO();
      const excludeId = optionalId(query.exclude_id, 'agendamento');

      const result = (await computeAvailability({ barberId, serviceId, date, excludeId })) ?? {
        open: false,
        slots: [] as string[],
        reason: null as string | null,
        duration: 0,
        price: 0,
      };
      return { status: 200, body: { ...result, date, barber_id: barberId, service_id: serviceId } };
    },
  },
  {
    method: 'GET',
    path: '/api/availability/range',
    handler: async ({ query }: RouteContext) => {
      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const from = query.from && isValidDate(query.from) ? query.from : todayISO();
      const daysParam = Number(query.days);
      const hasDays = Number.isInteger(daysParam) && daysParam > 0;
      const to = hasDays
        ? addDays(from, Math.min(daysParam, 120) - 1)
        : query.to && isValidDate(query.to)
          ? query.to
          : addDays(from, 30);
      const excludeId = optionalId(query.exclude_id, 'agendamento');

      const dates: string[] = [];
      let cursor = from;
      let guard = 0;
      while (cursor <= to && guard < 120) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
        guard += 1;
      }

      const map = await computeAvailabilityRange({
        barberId,
        serviceId,
        dates,
        excludeId,
      });

      return {
        status: 200,
        body: dates.map((date) => {
          const day = map.get(date) ?? {
            open: false,
            slots: [] as string[],
            reason: null as string | null,
            duration: 0,
            price: 0,
          };
          return {
            date,
            open: day.open,
            reason: day.reason,
            duration: 'duration' in day ? day.duration : 0,
            price: 'price' in day ? day.price : 0,
            slots: day.slots,
            slots_count: day.slots.length,
            barber_id: barberId,
            service_id: serviceId,
          };
        }),
      };
    },
  },
];
