// Servico oficial de integracao com a WhatsApp Business Cloud API da Meta.
// Gerencia envio de mensagens, modelos (templates), fila/rotina de lembretes,
// notificacoes de equipe, idempotencia e auditoria de mensagens.

import { timingSafeEqual } from 'node:crypto';
import { all, get, getSetting, run } from './db.js';
import { addDays, formatDateBR, minutesToHHMM, nowMinutes, todayISO } from './time.js';
import { buildMessages, normalizePhone, type WhatsAppAppointmentInput } from './whatsapp.js';

export interface WhatsAppCloudConfig {
  enabled: boolean;
  isConfigured: boolean;
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
  apiVersion: string;
  adminPhone: string;
  notifyAdmin: boolean;
  notifyBarber: boolean;
  reminderEnabled: boolean;
  reminderHours: number;
  useTemplates: boolean;
  templateConfirmation: string;
  templateReminder: string;
  templateCancellation: string;
  webhookVerifyToken: string;
}

export interface SendMetaMessageOptions {
  to: string;
  messageType: string;
  bodyText?: string | null;
  templateName?: string | null;
  templateParams?: readonly (string | number | null | undefined)[];
  appointmentId?: number | null;
  recipientType?: string;
  idempotencyKey?: string | null;
}

export interface SendMetaMessageResult {
  success: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  metaMessageId?: string | null;
  messageId?: number | null;
  error?: string;
}

export interface NotifiableAppointment extends WhatsAppAppointmentInput {
  id?: number | null;
  barber_id?: number | null;
  client_phone?: string | null;
  price?: number | null;
}

export interface AppointmentNotificationResults {
  client: SendMetaMessageResult | null;
  barber: SendMetaMessageResult | null;
  admin: SendMetaMessageResult | null;
}

export interface ReminderBatchResult {
  processed: number;
  scanned?: number;
  sent: number;
  skipped?: boolean;
}

/** Carrega as configuracoes ativas (banco + variaveis de ambiente). */
export function getWhatsAppConfig(): WhatsAppCloudConfig {
  const env = process.env;
  const enabled =
    getSetting('whatsapp_cloud_enabled') === '1' ||
    env.WHATSAPP_CLOUD_ENABLED === '1' ||
    env.WHATSAPP_CLOUD_ENABLED === 'true';

  const phoneNumberId =
    getSetting('whatsapp_phone_number_id') || env.WHATSAPP_PHONE_NUMBER_ID || '';

  const accessToken =
    getSetting('whatsapp_access_token') || env.WHATSAPP_ACCESS_TOKEN || '';

  const wabaId =
    getSetting('whatsapp_business_account_id') || env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';

  const apiVersion =
    getSetting('whatsapp_api_version') || env.WHATSAPP_API_VERSION || 'v21.0';

  const adminPhone =
    getSetting('whatsapp_admin_phone') || env.WHATSAPP_ADMIN_PHONE || '';

  const notifyAdmin = getSetting('whatsapp_notify_admin', '1') === '1';
  const notifyBarber = getSetting('whatsapp_notify_barber', '1') === '1';
  const reminderEnabled = getSetting('whatsapp_reminder_enabled', '1') === '1';
  const reminderHours = Number(getSetting('whatsapp_reminder_hours', '24')) || 24;

  const useTemplates = getSetting('whatsapp_use_templates') === '1';
  const templateConfirmation =
    getSetting('whatsapp_template_confirmation') || 'confirmacao_agendamento';
  const templateReminder =
    getSetting('whatsapp_template_reminder') || 'lembrete_agendamento';
  const templateCancellation =
    getSetting('whatsapp_template_cancellation') || 'cancelamento_agendamento';

  const webhookVerifyToken =
    getSetting('whatsapp_webhook_verify_token') ||
    env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
    (env.NODE_ENV === 'production' ? '' : 'barber_webhook_secret');

  return {
    enabled,
    isConfigured: Boolean(enabled && phoneNumberId && accessToken),
    phoneNumberId,
    accessToken,
    wabaId,
    apiVersion,
    adminPhone: normalizePhone(adminPhone),
    notifyAdmin,
    notifyBarber,
    reminderEnabled,
    reminderHours,
    useTemplates,
    templateConfirmation,
    templateReminder,
    templateCancellation,
    webhookVerifyToken,
  };
}

export function isWhatsAppCloudEnabled(): boolean {
  return getWhatsAppConfig().enabled;
}

/**
 * Envia uma mensagem pela WhatsApp Business Cloud API da Meta.
 * Registra o historico e garante idempotencia.
 */
export async function sendMetaCloudMessage({
  to,
  messageType,
  bodyText = '',
  templateName = null,
  templateParams = [],
  appointmentId = null,
  recipientType = 'client',
  idempotencyKey = null,
}: SendMetaMessageOptions): Promise<SendMetaMessageResult> {
  const config = getWhatsAppConfig();
  const normalizedPhone = normalizePhone(to);

  if (!normalizedPhone) {
    throw new Error('Número de WhatsApp de destino inválido ou vazio.');
  }

  // 1. Protecao contra duplicidade (idempotencia)
  if (idempotencyKey) {
    const existing = await get(
      `SELECT id, status, meta_message_id, created_at, error_message
         FROM whatsapp_messages
        WHERE idempotency_key = ?`,
      [idempotencyKey]
    );

    if (existing) {
      const st = String(existing['status'] ?? '');
      if (st === 'sent' || st === 'delivered' || st === 'read') {
        return {
          success: true,
          duplicate: true,
          metaMessageId: existing['meta_message_id'] ? String(existing['meta_message_id']) : null,
          messageId: Number(existing['id']),
        };
      }
    }
  }

  // 2. Registro pendente no banco
  let messageRecordId: number | null = null;
  const contentPreview = bodyText || `Template: ${templateName} [${templateParams.join(', ')}]`;

  if (idempotencyKey) {
    const updateOrInsert = await run(
      `INSERT INTO whatsapp_messages
         (appointment_id, recipient_type, recipient_phone, message_type, idempotency_key, content, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT (idempotency_key) DO UPDATE
         SET content = excluded.content,
             attempts = whatsapp_messages.attempts + 1,
             updated_at = datetime('now','localtime')`,
      [appointmentId, recipientType, normalizedPhone, messageType, idempotencyKey, contentPreview]
    );
    messageRecordId = Number(updateOrInsert.lastInsertRowid) || null;
  } else {
    const ins = await run(
      `INSERT INTO whatsapp_messages
         (appointment_id, recipient_type, recipient_phone, message_type, content, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [appointmentId, recipientType, normalizedPhone, messageType, contentPreview]
    );
    messageRecordId = Number(ins.lastInsertRowid) || null;
  }

  // Se nao tiver a chave criada por ter sido update, busca o id
  if (!messageRecordId && idempotencyKey) {
    const row = await get('SELECT id FROM whatsapp_messages WHERE idempotency_key = ?', [
      idempotencyKey,
    ]);
    messageRecordId = row ? Number(row['id']) : null;
  }

  // 3. Validacao das credenciais da Meta
  if (!config.enabled) {
    const reason = 'Envio automático do WhatsApp Cloud API está desativado nas configurações.';
    if (messageRecordId) {
      await run(
        `UPDATE whatsapp_messages SET status = 'failed', error_message = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [reason, messageRecordId]
      );
    }
    return { success: false, skipped: true, error: reason };
  }

  if (!config.phoneNumberId || !config.accessToken) {
    const reason = 'WhatsApp Cloud API não configurada (defina Phone Number ID e Access Token).';
    if (messageRecordId) {
      await run(
        `UPDATE whatsapp_messages SET status = 'failed', error_message = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [reason, messageRecordId]
      );
    }
    throw new Error(reason);
  }

  // 4. Montagem da carga oficial da Meta
  const apiBase = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';
  const url = `${apiBase}/${config.apiVersion}/${config.phoneNumberId}/messages`;
  const payload =
    config.useTemplates && templateName
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'pt_BR' },
            components: [
              {
                type: 'body',
                parameters: templateParams.map((val) => ({
                  type: 'text',
                  text: String(val ?? ''),
                })),
              },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedPhone,
          type: 'text',
          text: {
            preview_url: false,
            body: bodyText ?? '',
          },
        };

  // 5. Chamada a API da Meta
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    const metaMessageId = data.messages?.[0]?.id;

    if (!response.ok || !metaMessageId) {
      const errorMsg =
        data.error?.message ||
        `Erro HTTP ${response.status} retornado pela API do WhatsApp da Meta`;

      if (messageRecordId) {
        await run(
          `UPDATE whatsapp_messages
              SET status = 'failed', error_message = ?, attempts = attempts + 1, updated_at = datetime('now','localtime')
            WHERE id = ?`,
          [errorMsg, messageRecordId]
        );
      }
      throw new Error(`[WhatsApp Meta API] ${errorMsg}`);
    }

    if (messageRecordId) {
      await run(
        `UPDATE whatsapp_messages
            SET status = 'sent', meta_message_id = ?, sent_at = datetime('now','localtime'), attempts = attempts + 1, error_message = NULL, updated_at = datetime('now','localtime')
          WHERE id = ?`,
        [metaMessageId, messageRecordId]
      );
    }

    return {
      success: true,
      metaMessageId,
      messageId: messageRecordId,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (messageRecordId) {
      await run(
        `UPDATE whatsapp_messages
            SET status = 'failed', error_message = ?, attempts = attempts + 1, updated_at = datetime('now','localtime')
          WHERE id = ?`,
        [errMsg, messageRecordId]
      );
    }
    throw error;
  }
}

/* --------------------------------------------------------------------------
 * Disparadores de Eventos do Negocio
 * ------------------------------------------------------------------------ */

/** Notifica cliente e equipe apos a criacao/confirmacao de agendamento. */
export async function notifyAppointmentCreatedOrConfirmed(
  appointment: NotifiableAppointment,
  baseUrl: string = ''
): Promise<AppointmentNotificationResults> {
  const config = getWhatsAppConfig();
  const messages = buildMessages(appointment, baseUrl);
  const results: AppointmentNotificationResults = { client: null, barber: null, admin: null };
  const apptId = appointment.id ? Number(appointment.id) : null;

  // 1. Mensagem para o cliente
  if (appointment.client_phone) {
    try {
      results.client = await sendMetaCloudMessage({
        to: appointment.client_phone,
        messageType: 'confirmation',
        bodyText: messages.confirmation,
        templateName: config.templateConfirmation,
        templateParams: [
          messages.values.cliente,
          messages.values.loja,
          messages.values.data,
          messages.values.hora,
          messages.values.barbeiro,
          messages.values.servico,
        ],
        appointmentId: apptId,
        recipientType: 'client',
        idempotencyKey: `confirm-client-${apptId ?? Date.now()}`,
      });
    } catch (err) {
      results.client = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // 2. Notificacao para o profissional (se ativo e com telefone configurado)
  if (config.notifyBarber && appointment.barber_id) {
    const barber = await get('SELECT phone, name FROM barbers WHERE id = ?', [
      appointment.barber_id,
    ]);
    const barberPhone = barber?.['phone'] ? String(barber['phone']) : '';
    if (barberPhone) {
      const barberText = `💈 *Novo agendamento na sua cadeira!*\n\nCliente: *${messages.values.cliente}*\nServiço: ${messages.values.servico}\nData: *${messages.values.data}* às *${messages.values.hora}*\nValor: R$ ${Number(appointment.price || 0).toFixed(2)}`;

      try {
        results.barber = await sendMetaCloudMessage({
          to: barberPhone,
          messageType: 'notification',
          bodyText: barberText,
          appointmentId: apptId,
          recipientType: 'barber',
          idempotencyKey: `notify-barber-${apptId ?? Date.now()}`,
        });
      } catch (err) {
        results.barber = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  // 3. Notificacao para o administrador da barbearia
  if (config.notifyAdmin && config.adminPhone) {
    const adminText = `💈 *Novo agendamento registrado!*\n\nBarbearia: ${messages.values.loja}\nCliente: *${messages.values.cliente}* (${appointment.client_phone ?? ''})\nProfissional: *${messages.values.barbeiro}*\nServiço: ${messages.values.servico}\nHorário: *${messages.values.data}* às *${messages.values.hora}*`;

    try {
      results.admin = await sendMetaCloudMessage({
        to: config.adminPhone,
        messageType: 'notification',
        bodyText: adminText,
        appointmentId: apptId,
        recipientType: 'admin',
        idempotencyKey: `notify-admin-${apptId ?? Date.now()}`,
      });
    } catch (err) {
      results.admin = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return results;
}

/** Notifica cliente e equipe quando um agendamento e cancelado. */
export async function notifyAppointmentCancelled(
  appointment: NotifiableAppointment,
  reason: string = '',
  baseUrl: string = ''
): Promise<AppointmentNotificationResults> {
  const config = getWhatsAppConfig();
  const messages = buildMessages(appointment, baseUrl);
  const results: AppointmentNotificationResults = { client: null, barber: null, admin: null };
  const apptId = appointment.id ? Number(appointment.id) : null;

  const cancelText = reason
    ? `${messages.cancellation}\nMotivo: ${reason}`
    : messages.cancellation;

  if (appointment.client_phone) {
    try {
      results.client = await sendMetaCloudMessage({
        to: appointment.client_phone,
        messageType: 'cancellation',
        bodyText: cancelText,
        templateName: config.templateCancellation,
        templateParams: [
          messages.values.cliente,
          messages.values.loja,
          messages.values.data,
          messages.values.hora,
        ],
        appointmentId: apptId,
        recipientType: 'client',
        idempotencyKey: `cancel-client-${apptId ?? 'na'}-${Date.now()}`,
      });
    } catch (err) {
      results.client = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (config.notifyBarber && appointment.barber_id) {
    const barber = await get('SELECT phone, name FROM barbers WHERE id = ?', [
      appointment.barber_id,
    ]);
    const barberPhone = barber?.['phone'] ? String(barber['phone']) : '';
    if (barberPhone) {
      const barberText = `❌ *Agendamento cancelado!*\n\nCliente: ${messages.values.cliente}\nData: ${messages.values.data} às ${messages.values.hora}\n${reason ? `Motivo: ${reason}` : ''}`;
      try {
        results.barber = await sendMetaCloudMessage({
          to: barberPhone,
          messageType: 'cancellation',
          bodyText: barberText,
          appointmentId: apptId,
          recipientType: 'barber',
          idempotencyKey: `cancel-barber-${apptId ?? 'na'}-${Date.now()}`,
        });
      } catch (err) {
        results.barber = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  return results;
}

/** Notifica cliente quando o horario e remarcado. */
export async function notifyAppointmentRescheduled(
  appointment: NotifiableAppointment,
  oldDateOrObj: string | { date?: string; start_time?: string } | null | undefined,
  oldTime: string = '',
  baseUrl: string = ''
): Promise<SendMetaMessageResult | null> {
  let oldDate = '';
  let resolvedOldTime = oldTime;
  if (oldDateOrObj && typeof oldDateOrObj === 'object') {
    oldDate = oldDateOrObj.date ?? '';
    resolvedOldTime = oldDateOrObj.start_time ?? '';
  } else if (typeof oldDateOrObj === 'string') {
    oldDate = oldDateOrObj;
  }

  const messages = buildMessages(appointment, baseUrl);
  const text = `🗓️ *Seu horário foi remarcado!*\n\nOlá ${messages.values.cliente}! Seu atendimento na ${messages.values.loja} agora está marcado para:\n\n*Nova data:* ${messages.values.data} às *${messages.values.hora}*\nProfissional: ${messages.values.barbeiro}\nServiço: ${messages.values.servico}\n\n(Horário anterior: ${formatDateBR(oldDate)} às ${resolvedOldTime})\n\nEsperamos você!`;

  if (!appointment.client_phone) return null;
  const apptId = appointment.id ? Number(appointment.id) : null;

  try {
    return await sendMetaCloudMessage({
      to: appointment.client_phone,
      messageType: 'reschedule',
      bodyText: text,
      appointmentId: apptId,
      recipientType: 'client',
      idempotencyKey: `reschedule-client-${apptId ?? 'na'}-${appointment.date ?? ''}-${appointment.start_time ?? ''}`,
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* --------------------------------------------------------------------------
 * Fila / Processamento de Lembretes (24h de antecedencia)
 * ------------------------------------------------------------------------ */

/** Varre agendamentos ativos que acontecerao nas proximas X horas e envia lembrete. */
export async function processAppointmentReminders(): Promise<ReminderBatchResult> {
  const config = getWhatsAppConfig();
  if (!config.enabled || !config.reminderEnabled || !config.isConfigured) {
    return { processed: 0, sent: 0, skipped: true };
  }

  const hours = config.reminderHours;
  const today = todayISO();
  const nowMin = nowMinutes();
  const startDT = `${today} ${minutesToHHMM(nowMin)}`;
  const endTotalMin = nowMin + Math.max(1, Number(hours) || 24) * 60;
  const endDate = addDays(today, Math.floor(endTotalMin / 1440));
  const endDT = `${endDate} ${minutesToHHMM(endTotalMin % 1440)}`;

  const appointments = await all(
    `SELECT a.id, a.client_id, a.barber_id, a.service_id, a.date, a.start_time,
            c.name AS client_name, c.phone AS client_phone,
            b.name AS barber_name,
            s.name AS service_name
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       JOIN barbers b ON b.id = a.barber_id
  LEFT JOIN services s ON s.id = a.service_id
      WHERE a.status IN ('pending', 'confirmed')
        AND (a.date || ' ' || a.start_time) >= ?
        AND (a.date || ' ' || a.start_time) <= ?
      ORDER BY a.date ASC, a.start_time ASC`,
    [startDT, endDT]
  );

  let sentCount = 0;

  for (const appt of appointments) {
    const clientPhone = appt['client_phone'] ? String(appt['client_phone']) : '';
    if (!clientPhone) continue;

    const apptId = Number(appt['id']);
    const apptDate = String(appt['date'] ?? '');
    const idempotencyKey = `reminder-${apptId}-${apptDate}`;
    const messages = buildMessages({
      date: apptDate,
      start_time: String(appt['start_time'] ?? ''),
      client_name: appt['client_name'] ? String(appt['client_name']) : null,
      barber_name: appt['barber_name'] ? String(appt['barber_name']) : null,
      service_name: appt['service_name'] ? String(appt['service_name']) : null,
    });

    try {
      const res = await sendMetaCloudMessage({
        to: clientPhone,
        messageType: 'reminder',
        bodyText: messages.reminder,
        templateName: config.templateReminder,
        templateParams: [
          messages.values.cliente,
          messages.values.loja,
          messages.values.data,
          messages.values.hora,
          messages.values.barbeiro,
        ],
        appointmentId: apptId,
        recipientType: 'client',
        idempotencyKey,
      });

      if (res.success && !res.duplicate) {
        sentCount += 1;
      }
    } catch (err) {
      console.error(
        `[WhatsApp Reminder] Falha no agendamento #${apptId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { processed: appointments.length, scanned: appointments.length, sent: sentCount };
}

/**
 * Rotina de pos-atendimento: envia agradecimento + convite para avaliacao
 * aos clientes que concluiram atendimento hoje (idempotente por agendamento).
 */
export async function processPostAppointmentFollowups(): Promise<ReminderBatchResult> {
  const config = getWhatsAppConfig();
  if (!config.enabled || !config.phoneNumberId || !config.accessToken) {
    return { skipped: true, processed: 0, sent: 0 };
  }

  const today = todayISO();
  const completedToday = await all(
    `SELECT a.id, a.date, a.start_time,
            c.name AS client_name, c.phone AS client_phone,
            b.name AS barber_name, s.name AS service_name
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       JOIN barbers b ON b.id = a.barber_id
  LEFT JOIN services s ON s.id = a.service_id
      WHERE a.status = 'completed'
        AND a.date = ?`,
    [today]
  );

  const shopName = getSetting('shop_name', 'Gestor de Barbearia');
  let sent = 0;

  for (const appt of completedToday) {
    const clientPhone = appt['client_phone'] ? String(appt['client_phone']) : '';
    if (!clientPhone) continue;
    const apptId = Number(appt['id']);
    const clientName = String(appt['client_name'] ?? 'cliente');
    const barberName = String(appt['barber_name'] ?? 'nosso profissional');
    const bodyText = `Olá ${clientName}! Obrigado por escolher a ${shopName} hoje com ${barberName}. Conte pra gente como foi sua experiência!`;
    try {
      const res = await sendMetaCloudMessage({
        to: clientPhone,
        messageType: 'followup',
        bodyText,
        appointmentId: apptId,
        recipientType: 'client',
        idempotencyKey: `followup-${apptId}`,
      });
      if (res.success && !res.duplicate) sent += 1;
    } catch (err) {
      console.error(
        `[WhatsApp Followup] Falha no agendamento #${apptId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { processed: completedToday.length, sent };
}

/* --------------------------------------------------------------------------
 * Worker em Segundo Plano
 * ------------------------------------------------------------------------ */

let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startWhatsAppWorker(intervalMs: number = 60000): void {
  if (workerInterval) return;

  setTimeout(() => {
    processAppointmentReminders().catch((err: unknown) => {
      console.error(
        '[WhatsApp Worker] Erro na execucao inicial:',
        err instanceof Error ? err.message : err
      );
    });
  }, 5000).unref();

  workerInterval = setInterval(() => {
    processAppointmentReminders().catch((err: unknown) => {
      console.error(
        '[WhatsApp Worker] Erro no ciclo de lembretes:',
        err instanceof Error ? err.message : err
      );
    });
  }, intervalMs);

  if (typeof workerInterval.unref === 'function') {
    workerInterval.unref();
  }
}

export function stopWhatsAppWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

/* --------------------------------------------------------------------------
 * Webhook Oficial da Meta
 * ------------------------------------------------------------------------ */

export function verifyWebhook(
  mode: string | null | undefined,
  token: string | null | undefined,
  challenge: string | null | undefined
): string | null {
  const config = getWhatsAppConfig();
  if (mode !== 'subscribe' || !config.webhookVerifyToken || typeof token !== 'string') {
    return null;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(config.webhookVerifyToken);
  if (a.length === b.length && timingSafeEqual(a, b)) {
    return challenge ?? null;
  }
  return null;
}

interface MetaWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{
          id?: string;
          status?: string;
        }>;
      };
    }>;
  }>;
}

export async function handleWebhookEvent(body: unknown): Promise<void> {
  const webhookBody = (body && typeof body === 'object' ? body : {}) as MetaWebhookBody;
  const entries = webhookBody.entry ?? [];
  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      const statuses = change.value?.statuses ?? [];
      for (const statusObj of statuses) {
        const metaId = statusObj.id;
        const status = statusObj.status;

        if (metaId && status) {
          const mappedStatus =
            status === 'delivered'
              ? 'delivered'
              : status === 'read'
                ? 'read'
                : status === 'failed'
                  ? 'failed'
                  : 'sent';

          await run(
            `UPDATE whatsapp_messages
                SET status = ?, updated_at = datetime('now','localtime')
              WHERE meta_message_id = ?`,
            [mappedStatus, metaId]
          );
        }
      }
    }
  }
}
