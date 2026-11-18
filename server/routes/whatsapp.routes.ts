// Rotas da API para gerenciamento do WhatsApp Cloud API, historico e webhook.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { all, get } from '../db.js';
import { HttpError } from '../http.js';
import type { RouteContext, RouteDefinition, SqlParam } from '../types.js';
import { digitsOnly, optionalString, requiredId, requiredString } from '../validate.js';
import {
  getWhatsAppConfig,
  handleWebhookEvent,
  processAppointmentReminders,
  processPostAppointmentFollowups,
  sendMetaCloudMessage,
  verifyWebhook,
} from '../whatsapp-cloud.js';

export const whatsappRoutes: RouteDefinition[] = [
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
    handler: async ({ body }: RouteContext) => {
      const to = digitsOnly(requiredString(body?.to, 'número de WhatsApp de teste'));
      if (to.length < 10 || to.length > 15) {
        throw new HttpError(
          400,
          'Informe um número com DDD válido (10 ou 11 dígitos, ex.: 11999998888).'
        );
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
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Falha ao comunicar com a API do WhatsApp da Meta.';
        throw new HttpError(502, message || 'Falha ao comunicar com a API do WhatsApp da Meta.');
      }
    },
  },

  // 3. Historico de mensagens enviadas e auditoria de erros
  {
    method: 'GET',
    path: '/api/whatsapp/messages',
    handler: async ({ query = {}, shopId = 1 }: RouteContext) => {
      const q = query || {};
      const sid = Number(shopId) || 1;
      const limit = Math.min(Math.max(Number(q.limit || 50), 1), 100);
      const offset = Math.max(Number(q.offset || 0), 0);
      const where = ['COALESCE(a.shop_id, 1) = ?'];
      const params: SqlParam[] = [sid];

      if (q.status) {
        where.push('wm.status = ?');
        params.push(String(q.status));
      }
      if (q.recipient_type) {
        where.push('wm.recipient_type = ?');
        params.push(String(q.recipient_type));
      }
      if (q.appointment_id) {
        where.push('wm.appointment_id = ?');
        params.push(Number(q.appointment_id));
      }

      const whereClause = `WHERE ${where.join(' AND ')}`;

      const [countRow, rows] = await Promise.all([
        get(
          `SELECT COUNT(*) as total FROM whatsapp_messages wm LEFT JOIN appointments a ON a.id = wm.appointment_id ${whereClause}`,
          params
        ),
        all(
          `SELECT wm.id, wm.appointment_id, wm.recipient_type, wm.recipient_phone, wm.message_type,
                  wm.content, wm.meta_message_id, wm.status, wm.error_message, wm.attempts, wm.created_at, wm.sent_at
             FROM whatsapp_messages wm
             LEFT JOIN appointments a ON a.id = wm.appointment_id
           ${whereClause}
           ORDER BY wm.id DESC
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
  {
    method: 'POST',
    path: '/api/whatsapp/trigger-followups',
    handler: async () => {
      const result = await processPostAppointmentFollowups();
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
    handler: async ({ params, shopId = 1 }: RouteContext) => {
      const msgId = requiredId(params.id, 'id da mensagem');
      const sid = Number(shopId) || 1;
      const msg = await get(
        `SELECT wm.*
           FROM whatsapp_messages wm
           LEFT JOIN appointments a ON a.id = wm.appointment_id
          WHERE wm.id = ? AND COALESCE(a.shop_id, 1) = ?`,
        [msgId, sid]
      );

      if (!msg) throw new HttpError(404, 'Mensagem não encontrada no histórico.');

      const result = await sendMetaCloudMessage({
        to: String(msg.recipient_phone || ''),
        messageType: String(msg.message_type || 'notification'),
        bodyText: String(msg.content || ''),
        appointmentId: msg.appointment_id ? Number(msg.appointment_id) : null,
        recipientType: String(msg.recipient_type || 'client'),
        idempotencyKey: `resend-${Number(msg.id)}-${Date.now()}`,
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
    handler: async ({ query = {} }: RouteContext) => {
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
    handler: async ({ req, body }: RouteContext) => {
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      if (appSecret) {
        const sigHeader = String(req.headers['x-hub-signature-256'] || '');
        const rawPayload =
          typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(body || {});
        const expected =
          'sha256=' + createHmac('sha256', appSecret).update(rawPayload).digest('hex');
        const a = Buffer.from(sigHeader);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          throw new HttpError(403, 'Assinatura X-Hub-Signature-256 invalida.');
        }
      } else if (process.env.NODE_ENV === 'production' || getWhatsAppConfig().enabled) {
        throw new HttpError(503, 'WHATSAPP_APP_SECRET nao configurado.');
      }
      await handleWebhookEvent(body);
      return { status: 200, body: { status: 'ok' } };
    },
  },
];
