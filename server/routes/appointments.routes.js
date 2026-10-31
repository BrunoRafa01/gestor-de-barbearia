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
import { buildMessages, waLink } from '../whatsapp.js';
import {
  notifyAppointmentCancelled,
  notifyAppointmentCreatedOrConfirmed,
  notifyAppointmentRescheduled,
} from '../whatsapp-cloud.js';
import { optionalId, requiredId } from '../validate.js';
import { addDays, isValidDate, todayISO } from '../time.js';

export const appointmentRoutes = [
  {
    method: 'GET',
    path: '/api/appointments',
    handler: async ({ query }) => {
      const filters = {
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
    handler: async ({ params }) => {
      const appointment = await getAppointmentById(requiredId(params.id, 'agendamento'));
      if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');
      return { status: 200, body: appointment };
    },
  },
  {
    method: 'GET',
    path: '/api/appointments/:id/whatsapp',
    handler: async ({ params, query }) => {
      const appointment = await getAppointmentById(requiredId(params.id, 'agendamento'));
      if (!appointment) throw new HttpError(404, 'Agendamento nao encontrado.');

      const messages = buildMessages({
        ...appointment,
        shop_name: getSetting('shop_name', 'Gestor de Barbearia'),
      });

      const type = ['confirmation', 'reminder', 'cancellation'].includes(query.type)
        ? query.type
        : 'confirmation';
      const message = messages[type];

      return {
        status: 200,
        body: {
          type,
          phone: appointment.client_phone,
          message,
          link: waLink(appointment.client_phone, message),
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
    handler: async ({ body }) => {
      const created = await createAppointment({ ...body, source: 'admin' });
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
    handler: async ({ params, body }) => {
      const id = requiredId(params.id, 'agendamento');
      const existing = await getAppointmentById(id);
      const updated = await updateAppointment(id, body);

      try {
        if (existing && (existing.date !== updated.date || existing.start_time !== updated.start_time)) {
          await notifyAppointmentRescheduled(updated, existing);
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
    handler: async ({ params, body }) => {
      const id = requiredId(params.id, 'agendamento');
      const existing = await getAppointmentById(id);
      const updated = await setAppointmentStatus(id, body.status);

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
    handler: async ({ params }) => {
      const id = requiredId(params.id, 'agendamento');
      const existing = await getAppointmentById(id);
      const result = await deleteAppointment(id);

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
    handler: async ({ query }) => {
      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const date = isValidDate(query.date) ? query.date : todayISO();
      const excludeId = optionalId(query.exclude_id, 'agendamento');

      const result = await computeAvailability({ barberId, serviceId, date, excludeId });
      return { status: 200, body: { ...result, date, barber_id: barberId, service_id: serviceId } };
    },
  },
  {
    method: 'GET',
    path: '/api/availability/range',
    handler: async ({ query }) => {
      const barberId = requiredId(query.barber_id, 'profissional');
      const serviceId = requiredId(query.service_id, 'servico');
      const from = isValidDate(query.from) ? query.from : todayISO();
      const daysParam = Number(query.days);
      const hasDays = Number.isInteger(daysParam) && daysParam > 0;
      const to = hasDays
        ? addDays(from, Math.min(daysParam, 120) - 1)
        : isValidDate(query.to)
          ? query.to
          : addDays(from, 30);
      const excludeId = optionalId(query.exclude_id, 'agendamento');

      const dates = [];
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
          const day = map.get(date) || { open: false, slots: [], reason: null };
          return {
            date,
            open: day.open,
            reason: day.reason,
            duration: day.duration,
            price: day.price,
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
