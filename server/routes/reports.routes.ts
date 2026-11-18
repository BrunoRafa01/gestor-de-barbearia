// Rotas HTTP de relatorios gerenciais.

import { buildReport } from '../reports.js';
import type { RouteContext, RouteDefinition } from '../types.js';

export const reportRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/reports',
    handler: async ({ query, shopId = 1 }: RouteContext) => ({
      status: 200,
      body: await buildReport(query, shopId),
    }),
  },
];
