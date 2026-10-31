// Servico oficial de integracao com a WhatsApp Business Cloud API da Meta.
// Gerencia envio de mensagens, modelos (templates), fila/rotina de lembretes,
// notificacoes de equipe, idempotencia e auditoria de mensagens.

import { all, get, getSetting, run } from './db.js';
import { buildMessages, normalizePhone } from './whatsapp.js';
import { formatDateBR } from './time.js';

/** Carrega as configuracoes ativas (banco + variaveis de ambiente). */
export function getWhatsAppConfig() {
  const env = process.env;
  const enabled =
    getSetting('whatsapp_cloud_enabled') === '1' ||
    env.WHATSAPP_CLOUD_ENABLED === '1' ||
    env.WHATSAPP_CLOUD_ENABLED === 'true';

  const phoneNumberId =
    getSetting('whatsapp_phone_number_id') ||
    env.WHATSAPP_PHONE_NUMBER_ID ||
    '';

  const accessToken =
    getSetting('whatsapp_access_token') ||
    env.WHATSAPP_ACCESS_TOKEN ||
    '';

  const wabaId =
    getSetting('whatsapp_business_account_id') ||
    env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
    '';

  const apiVersion =
    getSetting('whatsapp_api_version') ||
    env.WHATSAPP_API_VERSION ||
    'v21.0';

  const adminPhone =
    getSetting('whatsapp_admin_phone') ||
    env.WHATSAPP_ADMIN_PHONE ||
    '';

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
    'barber_webhook_secret';

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

/**
 * Envia uma mensagem pela WhatsApp Business Cloud API da Meta.
 * Registra o historico e garante idempotencia.
 */
export async function sendMetaCloudMessage({
  to,
  messageType,
  bodyText,
  templateName = null,
  templateParams = [],
  appointmentId = null,
  recipientType = 'client',
  idempotencyKey = null,
}) {
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
      if (existing.status === 'sent' || existing.status === 'delivered' || existing.status === 'read') {
        return {
          success: true,
          duplicate: true,
          metaMessageId: existing.meta_message_id,
          messageId: existing.id,
        };
      }
    }
  }

  // 2. Registro pendente no banco
  let messageRecordId = null;
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
    messageRecordId = Number(updateOrInsert.lastInsertRowid);
  } else {
    const ins = await run(
      `INSERT INTO whatsapp_messages
         (appointment_id, recipient_type, recipient_phone, message_type, content, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [appointmentId, recipientType, normalizedPhone, messageType, contentPreview]
    );
    messageRecordId = Number(ins.lastInsertRowid);
  }

  // Se nao tiver a chave criada por ter sido update, busca o id
  if (!messageRecordId && idempotencyKey) {
    const row = await get('SELECT id FROM whatsapp_messages WHERE idempotency_key = ?', [idempotencyKey]);
    messageRecordId = row ? Number(row.id) : null;
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
  let payload;

  if (config.useTemplates && templateName) {
    payload = {
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
              text: String(val || ''),
            })),
          },
        ],
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: bodyText,
      },
    };
  }

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

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.messages?.[0]?.id) {
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

    const metaMessageId = data.messages[0].id;

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
    if (messageRecordId) {
      await run(
        `UPDATE whatsapp_messages
            SET status = 'failed', error_message = ?, attempts = attempts + 1, updated_at = datetime('now','localtime')
          WHERE id = ?`,
        [error.message || String(error), messageRecordId]
      );
    }
    throw error;
  }
}

/* --------------------------------------------------------------------------
 * Disparadores de Eventos do Negocio
 * ------------------------------------------------------------------------ */

/**
 * Notifica cliente e equipe apos a criacao/confirmacao de agendamento.
 */
export async function notifyAppointmentCreatedOrConfirmed(appointment, baseUrl = '') {
  const config = getWhatsAppConfig();
  const messages = buildMessages(appointment, baseUrl);
  const results = { client: null, barber: null, admin: null };

  // 1. Mensagem para o cliente (nunca usa o cliente como remetente!)
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
        appointmentId: appointment.id,
        recipientType: 'client',
        idempotencyKey: `confirm-client-${appointment.id}`,
      });
    } catch (err) {
      results.client = { success: false, error: err.message };
    }
  }

  // 2. Notificacao para o profissional (se ativo e com telefone configurado)
  if (config.notifyBarber && appointment.barber_id) {
    const barber = await get('SELECT phone, name FROM barbers WHERE id = ?', [appointment.barber_id]);
    if (barber?.phone) {
      const barberText = `💈 *Novo agendamento na sua cadeira!*\n\nCliente: *${messages.values.cliente}*\nServiço: ${messages.values.servico}\nData: *${messages.values.data}* às *${messages.values.hora}*\nValor: R$ ${Number(appointment.price || 0).toFixed(2)}`;

      try {
        results.barber = await sendMetaCloudMessage({
          to: barber.phone,
          messageType: 'notification',
          bodyText: barberText,
          appointmentId: appointment.id,
          recipientType: 'barber',
          idempotencyKey: `notify-barber-${appointment.id}`,
        });
      } catch (err) {
        results.barber = { success: false, error: err.message };
      }
    }
  }

  // 3. Notificacao para o administrador da barbearia
  if (config.notifyAdmin && config.adminPhone) {
    const adminText = `💈 *Novo agendamento registrado!*\n\nBarbearia: ${messages.values.loja}\nCliente: *${messages.values.cliente}* (${appointment.client_phone})\nProfissional: *${messages.values.barbeiro}*\nServiço: ${messages.values.servico}\nHorário: *${messages.values.data}* às *${messages.values.hora}*`;

    try {
      results.admin = await sendMetaCloudMessage({
        to: config.adminPhone,
        messageType: 'notification',
        bodyText: adminText,
        appointmentId: appointment.id,
        recipientType: 'admin',
        idempotencyKey: `notify-admin-${appointment.id}`,
      });
    } catch (err) {
      results.admin = { success: false, error: err.message };
    }
  }

  return results;
}

/**
 * Notifica cliente e equipe quando um agendamento e cancelado.
 */
export async function notifyAppointmentCancelled(appointment, reason = '', baseUrl = '') {
  const config = getWhatsAppConfig();
  const messages = buildMessages(appointment, baseUrl);
  const results = { client: null, barber: null, admin: null };

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
        appointmentId: appointment.id,
        recipientType: 'client',
        idempotencyKey: `cancel-client-${appointment.id}-${Date.now()}`,
      });
    } catch (err) {
      results.client = { success: false, error: err.message };
    }
  }

  if (config.notifyBarber && appointment.barber_id) {
    const barber = await get('SELECT phone, name FROM barbers WHERE id = ?', [appointment.barber_id]);
    if (barber?.phone) {
      const barberText = `❌ *Agendamento cancelado!*\n\nCliente: ${messages.values.cliente}\nData: ${messages.values.data} às ${messages.values.hora}\n${reason ? `Motivo: ${reason}` : ''}`;
      try {
        results.barber = await sendMetaCloudMessage({
          to: barber.phone,
          messageType: 'cancellation',
          bodyText: barberText,
          appointmentId: appointment.id,
          recipientType: 'barber',
          idempotencyKey: `cancel-barber-${appointment.id}-${Date.now()}`,
        });
      } catch (err) {
        results.barber = { success: false, error: err.message };
      }
    }
  }

  return results;
}

/**
 * Notifica cliente quando o horario e remarcado.
 */
export async function notifyAppointmentRescheduled(appointment, oldDateOrObj, oldTime = '', baseUrl = '') {
  let oldDate = oldDateOrObj;
  if (oldDateOrObj && typeof oldDateOrObj === 'object') {
    oldDate = oldDateOrObj.date;
    oldTime = oldDateOrObj.start_time;
  }
  const messages = buildMessages(appointment, baseUrl);
  const text = `🗓️ *Seu horário foi remarcado!*\n\nOlá ${messages.values.cliente}! Seu atendimento na ${messages.values.loja} agora está marcado para:\n\n*Nova data:* ${messages.values.data} às *${messages.values.hora}*\nProfissional: ${messages.values.barbeiro}\nServiço: ${messages.values.servico}\n\n(Horário anterior: ${formatDateBR(oldDate)} às ${oldTime})\n\nEsperamos você!`;

  if (!appointment.client_phone) return null;

  try {
    return await sendMetaCloudMessage({
      to: appointment.client_phone,
      messageType: 'reschedule',
      bodyText: text,
      appointmentId: appointment.id,
      recipientType: 'client',
      idempotencyKey: `reschedule-client-${appointment.id}-${appointment.date}-${appointment.start_time}`,
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* --------------------------------------------------------------------------
 * Fila / Processamento de Lembretes (24h de antecedencia)
 * ------------------------------------------------------------------------ */

/**
 * Varre agendamentos ativos que acontecerao nas proximas X horas e envia lembrete.
 */
export async function processAppointmentReminders() {
  const config = getWhatsAppConfig();
  if (!config.enabled || !config.reminderEnabled || !config.isConfigured) {
    return { processed: 0, sent: 0, skipped: true };
  }

  const hours = config.reminderHours;

  // Busca agendamentos com status pending ou confirmed cuja data/hora
  // esta entre AGORA e AGORA + X HORAS
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
        AND datetime(a.date || ' ' || a.start_time) >= datetime('now', 'localtime')
        AND datetime(a.date || ' ' || a.start_time) <= datetime('now', 'localtime', '+' || ? || ' hours')
      ORDER BY a.date ASC, a.start_time ASC`,
    [hours]
  );

  let sentCount = 0;

  for (const appt of appointments) {
    if (!appt.client_phone) continue;

    const idempotencyKey = `reminder-${appt.id}-${appt.date}`;
    const messages = buildMessages(appt);

    try {
      const res = await sendMetaCloudMessage({
        to: appt.client_phone,
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
        appointmentId: appt.id,
        recipientType: 'client',
        idempotencyKey,
      });

      if (res?.success && !res.duplicate) {
        sentCount += 1;
      }
    } catch (err) {
      console.error(`[WhatsApp Reminder] Falha no agendamento #${appt.id}:`, err.message);
    }
  }

  return { processed: appointments.length, scanned: appointments.length, sent: sentCount };
}

/* --------------------------------------------------------------------------
 * Worker em Segundo Plano
 * ------------------------------------------------------------------------ */

let workerInterval = null;

export function startWhatsAppWorker(intervalMs = 60000) {
  if (workerInterval) return;

  // Roda uma vez logo apos subir e depois no intervalo definido
  setTimeout(() => {
    processAppointmentReminders().catch((err) => {
      console.error('[WhatsApp Worker] Erro na execucao inicial:', err.message);
    });
  }, 5000);

  workerInterval = setInterval(() => {
    processAppointmentReminders().catch((err) => {
      console.error('[WhatsApp Worker] Erro no ciclo de lembretes:', err.message);
    });
  }, intervalMs);

  if (typeof workerInterval.unref === 'function') {
    workerInterval.unref();
  }
}

export function stopWhatsAppWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

/* --------------------------------------------------------------------------
 * Webhook Oficial da Meta
 * ------------------------------------------------------------------------ */

export function verifyWebhook(mode, token, challenge) {
  const config = getWhatsAppConfig();
  if (mode === 'subscribe' && token === config.webhookVerifyToken) {
    return challenge;
  }
  return null;
}

export async function handleWebhookEvent(body) {
  const entries = body?.entry || [];
  for (const entry of entries) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      const statuses = change?.value?.statuses || [];
      for (const statusObj of statuses) {
        const metaId = statusObj.id;
        const status = statusObj.status; // sent, delivered, read, failed

        if (metaId && status) {
          const mappedStatus =
            status === 'delivered' ? 'delivered' : status === 'read' ? 'read' : status === 'failed' ? 'failed' : 'sent';

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
