/**
 * Cliente HTTP tipado da API do Gestor de Barbearia — NOVA RUNTIME
 */

export class ApiError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function errorMessage(err: unknown, fallback = 'Ocorreu um erro inesperado.'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

export function errorStatus(err: unknown): number {
  if (err instanceof ApiError) return err.status;
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === 'number' ? s : 0;
  }
  return 0;
}

interface ErrorPayload {
  error?: string;
  details?: unknown;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Não foi possível falar com o servidor. Verifique se ele está rodando.');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errObj = (payload && typeof payload === 'object' ? payload : null) as ErrorPayload | null;
    throw new ApiError(
      response.status,
      errObj?.error || `Erro ${response.status}`,
      errObj?.details
    );
  }

  return payload as T;
}

export const api = {
  get: <T = unknown>(path: string): Promise<T> => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  put: <T = unknown>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body ?? {}),
  patch: <T = unknown>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body ?? {}),
  del: <T = unknown>(path: string): Promise<T> => request<T>('DELETE', path),
};

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Monta a query string ignorando valores vazios. */
export function query(params?: QueryParams): string {
  const search = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
