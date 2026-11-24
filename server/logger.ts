// Registro estruturado de erros (JSON em linha unica para observabilidade em producao).

import { logSecurityEvent } from './security.js';

export interface StructuredErrorContext {
  requestId?: string;
  method?: string;
  path?: string;
  shopId?: number;
  status?: number;
  scope?: string;
}

export interface LastErrorSummary {
  timestamp: string;
  message: string;
  path?: string;
  status?: number;
  request_id?: string;
  scope?: string;
}

let totalErrors = 0;
let lastError: LastErrorSummary | null = null;

export function logStructuredError(
  err: unknown,
  context: StructuredErrorContext = {}
): LastErrorSummary {
  const timestamp = new Date().toISOString();
  const errorObj = err instanceof Error ? err : new Error(String(err));
  const summary: LastErrorSummary = {
    timestamp,
    message: errorObj.message || 'Erro desconhecido',
    ...(context.path ? { path: context.path } : {}),
    ...(context.status !== undefined ? { status: context.status } : {}),
    ...(context.requestId ? { request_id: context.requestId } : {}),
    ...(context.scope ? { scope: context.scope } : {}),
  };

  totalErrors += 1;
  lastError = summary;

  const payload = {
    level: 'error',
    timestamp,
    request_id: context.requestId ?? null,
    method: context.method ?? null,
    path: context.path ?? null,
    shop_id: context.shopId ?? null,
    status: context.status ?? 500,
    scope: context.scope ?? 'http',
    name: errorObj.name || 'Error',
    message: summary.message,
    stack: errorObj.stack ? errorObj.stack.split('\n').slice(0, 6).join(' | ') : undefined,
  };

  console.error(JSON.stringify(payload));

  if ((context.status ?? 500) >= 500) {
    logSecurityEvent('INTERNAL_ERROR', {
      scope: context.scope ?? 'http',
      path: context.path ?? null,
      request_id: context.requestId ?? null,
      message: summary.message.slice(0, 180),
    });
  }

  return summary;
}

export function getErrorStats(): { total_errors: number; last_error: LastErrorSummary | null } {
  return {
    total_errors: totalErrors,
    last_error: lastError,
  };
}
