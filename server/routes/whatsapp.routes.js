// Rotas da API para gerenciamento do WhatsApp Cloud API, historico e webhook.

import { all, get, run } from '../db.js';
import { HttpError } from '../http.js';
import { digitsOnly, optionalString, requiredId, requiredString } from '../validate.js';
import {
  getWhatsAppConfig,
  handleWebhookEvent,
  processAppointmentReminders,
  sendMetaCloudMessage,
  verifyWebhook,
} from '../whatsapp-cloud.js';

export const whatsappRoutes = [
  // 1. Status e configuracoes publicas do WhatsApp (sem expor segredos)
  {
    method: 'GET',
    path: '/api/whatsapp/config',
    handler: async () => {
      const cfg = getWhatsAppConfig();
      return {
        status: 200,
        body: {
          enabled: cfg.enabled,
          is_configured: cfg.isConfigured,
          phone_number_id: cfg.phoneNumberId || '',
          business_account_id: cfg.wabaId || '',
          api_version: cfg.apiVersion,
          has_access_token: Boolean(cfg.accessToken),
          admin_phone: cfg.adminPhone || '',
          notify_admin: cfg.notifyAdmin,
          notify_barber: cfg.notifyBarber,
          reminder_enabled: cfg.reminderEnabled,
          reminder_hours: cfg.reminderHours,
          use_templates: cfg.useTemplates,
          template_confirmation: cfg.templateConfirmation,
          template_reminder: cfg.templateReminder,
          template_cancellation: cfg.templateCancellation,
        },
      };
    },
  },

  // 2. Envio de mensagem de teste real via Meta WhatsApp Cloud API
  {
    method: 'POST',
    path: '/api/whatsapp/test',
    handler: async ({ body }) => {
      const to = digitsOnly(requiredString(body?.to, 'número de WhatsApp de teste'));
      if (to.length < 10 || to.length > 15) {
        throw new HttpError(400, 'Informe um número com DDD válido (10 ou 11 dígitos, ex.: 11999998888).');
      }

      const testText =
        optionalString(body?.message, 'mensagem de teste', 500) ||
        '💈 *Gestor de Barbearia*\n\nEsta é uma mensagem de teste enviada pela WhatsApp Business Cloud API oficial da Meta. Sua conexão está funcionando perfeitamente!';

      try {
        const result = await sendMetaCloudMessage({
          to,
          messageType: 'test',
          bodyText: testText,
          recipientType: 'admin',
          idempotencyKey: `test-${to}-${Date.now()}`,
        });

        return {
          status: 200,
          body: {
            success: true,
            message: 'Mensagem de teste enviada com sucesso pela Meta!',
            meta_message_id: result.metaMessageId,
            to,
          },
        };
      } catch (error) {
        throw new HttpError(502, error.message || 'Falha ao comunicar com a API do WhatsApp da Meta.');
      }
    },
  },

  // 3. Historico de mensagens enviadas e auditoria de erros
  {
    method: 'GET',
    path: '/api/whatsapp/messages',
    handler: async ({ query = {} }) => {
      const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
      const offset = Math.max(Number(query.offset || 0), 0);
      const where = [];
      const params = [];

      if (query.status) {
        where.push('status = ?');
        params.push(String(query.status));
      }
      if (query.recipient_type) {
        where.push('recipient_type = ?');
        params.push(String(query.recipient_type));
      }
      if (query.appointment_id) {
        where.push('appointment_id = ?');
        params.push(Number(query.appointment_id));
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const [countRow, rows] = await Promise.all([
        get(`SELECT COUNT(*) as total FROM whatsapp_messages ${whereClause}`, params),
        all(
          `SELECT id, appointment_id, recipient_type, recipient_phone, message_type,
                  content, meta_message_id, status, error_message, attempts, created_at, sent_at
             FROM whatsapp_messages
           ${whereClause}
           ORDER BY id DESC
           LIMIT ? OFFSET ?`,
          [...params, limit, offset]
        ),
      ]);

      return {
        status: 200,
        body: {
          total: Number(countRow?.total || 0),
          limit,
          offset,
          messages: rows || [],
        },
      };
    },
  },

  // 4. Disparo manual da rotina de lembretes de 24h
  {
    method: 'POST',
    path: '/api/whatsapp/trigger-reminders',
    handler: async () => {
      const result = await processAppointmentReminders();
      return {
        status: 200,
        body: {
          success: true,
          processed: result.processed,
          sent: result.sent,
          skipped: Boolean(result.skipped),
        },
      };
    },
  },

  // 5. Reenvio de mensagem com falha
  {
    method: 'POST',
    path: '/api/whatsapp/resend/:id',
    handler: async ({ params }) => {
      const msgId = requiredId(params.id, 'id da mensagem');
      const msg = await get('SELECT * FROM whatsapp_messages WHERE id = ?', [msgId]);

      if (!msg) throw new HttpError(404, 'Mensagem não encontrada no histórico.');

      const result = await sendMetaCloudMessage({
        to: msg.recipient_phone,
        messageType: msg.message_type,
        bodyText: msg.content,
        appointmentId: msg.appointment_id,
        recipientType: msg.recipient_type,
        idempotencyKey: `resend-${msg.id}-${Date.now()}`,
      });

      return {
        status: 200,
        body: {
          success: true,
          meta_message_id: result.metaMessageId,
        },
      };
    },
  },

  // 6. Webhook da Meta: verificacao GET (publico)
  {
    method: 'GET',
    path: '/api/whatsapp/webhook',
    auth: false,
    handler: async ({ query = {} }) => {
      const mode = query['hub.mode'];
      const token = query['hub.verify_token'];
      const challenge = query['hub.challenge'];

      const verified = verifyWebhook(mode, token, challenge);
      if (verified) {
        return {
          status: 200,
          body: verified,
        };
      }
      throw new HttpError(403, 'Verificação do Webhook da Meta falhou.');
    },
  },

  // 7. Webhook da Meta: notificacoes de entrega/leitura POST (publico)
  {
    method: 'POST',
    path: '/api/whatsapp/webhook',
    auth: false,
    handler: async ({ body }) => {
      await handleWebhookEvent(body);
      return { status: 200, body: { status: 'ok' } };
    },
  },
];
