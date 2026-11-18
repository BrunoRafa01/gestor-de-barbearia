// Rotas HTTP do modulo Financeiro: resumo, despesas e fechamento de caixa.

import { buildFinancialSummary, createExpense, deleteExpense } from '../finance.js';
import type { RouteContext, RouteDefinition } from '../types.js';
import { requiredId } from '../validate.js';

export const financeRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/finance/summary',
    handler: async ({ query, shopId = 1 }: RouteContext) => ({
      status: 200,
      body: await buildFinancialSummary(query, shopId),
    }),
  },
  {
    method: 'POST',
    path: '/api/finance/expenses',
    handler: async ({ body, shopId = 1 }: RouteContext) => ({
      status: 201,
      body: await createExpense(body, shopId),
    }),
  },
  {
    method: 'DELETE',
    path: '/api/finance/expenses/:id',
    handler: async ({ params, shopId = 1 }: RouteContext) => ({
      status: 200,
      body: await deleteExpense(requiredId(params.id, 'despesa'), shopId),
    }),
  },
];
