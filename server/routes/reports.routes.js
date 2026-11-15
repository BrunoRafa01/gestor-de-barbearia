// Rotas HTTP de relatorios gerenciais.

import { buildReport } from '../reports.js';

export const reportRoutes = [
  {
    method: 'GET',
    path: '/api/reports',
    handler: async ({ query }) => ({
      status: 200,
      body: await buildReport(query),
    }),
  },
];
