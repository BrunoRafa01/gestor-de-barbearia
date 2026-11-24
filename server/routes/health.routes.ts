// Health check usado pelo Render (e por qualquer monitor externo) para saber se
// a aplicacao esta no ar, se o banco responde e como esta a fila de lembretes/WhatsApp.

import { driverKind, healthCheck } from '../db.js';
import { getErrorStats } from '../logger.js';
import type { RouteDefinition } from '../types.js';
import { getReminderQueueStats, getWhatsAppConfig } from '../whatsapp-cloud.js';

const startedAt = Date.now();

export const healthRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/health',
    auth: false,
    handler: async () => {
      const started = Date.now();
      const database = await healthCheck();
      const ok = Boolean(database.ok);
      const latency_ms = Number.isFinite(database.latency_ms)
        ? database.latency_ms
        : Date.now() - started;

      const waConfig = getWhatsAppConfig();
      const reminderStats = ok
        ? await getReminderQueueStats().catch(() => null)
        : null;

      return {
        status: ok ? 200 : 503,
        body: {
          status: ok ? 'ok' : 'degraded',
          service: 'Gestor de Barbearia',
          company: 'Nova Runtime',
          uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
          driver: driverKind(),
          database: { ok, latency_ms },
          reminders: reminderStats
            ? {
                pending_queue: reminderStats.pending_queue,
                worker_active: reminderStats.worker_active,
                last_run_at: reminderStats.last_run_at,
                last_result: reminderStats.last_result,
              }
            : { pending_queue: 0, worker_active: false, last_run_at: null, last_result: null },
          whatsapp: {
            enabled: waConfig.enabled,
            configured: waConfig.isConfigured,
            last_sent_at: reminderStats?.last_whatsapp.sent_at ?? null,
            last_status: reminderStats?.last_whatsapp.status ?? null,
          },
          errors: getErrorStats(),
          timestamp: new Date().toISOString(),
        },
      };
    },
  },
];
