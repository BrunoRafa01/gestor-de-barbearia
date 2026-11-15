// Health check usado pelo Render (e por qualquer monitor externo) para saber se
// a aplicacao esta no ar e se o banco de dados responde.

import { driverKind, healthCheck } from '../db.js';

const startedAt = Date.now();

export const healthRoutes = [
  {
    method: 'GET',
    path: '/health',
    auth: false,
    handler: async () => {
      const started = Date.now();
      const database = await healthCheck();
      const ok = database.ok;
      const latency_ms = Number.isFinite(database.latency_ms)
        ? database.latency_ms
        : Date.now() - started;

      return {
        status: ok ? 200 : 503,
        body: {
          status: ok ? 'ok' : 'degraded',
          service: 'Gestor de Barbearia',
          company: 'Nova Runtime',
          uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
          driver: driverKind(),
          database: { ok, latency_ms },
          timestamp: new Date().toISOString(),
        },
      };
    },
  },
];
