// Definicoes estritas de tipos TypeScript para o backend do Gestor de Barbearia (NOVA RUNTIME).

import type { IncomingMessage, ServerResponse } from 'node:http';

export type SqlParam = string | number | bigint | Uint8Array | null;
export type DbRow = Record<string, unknown>;

export interface DbRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type AppointmentSource = 'admin' | 'public';
export type UserRole = 'owner' | 'staff' | 'master';
export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'other';

export interface SessionPayload {
  sub: string;
  shop_id: number;
  role: UserRole | string;
  ver: number;
  iat: number;
  exp: number;
}

export interface AppRequest extends IncomingMessage {
  rawBody?: string;
}

export interface RouteContext {
  req: AppRequest;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  session: SessionPayload | null;
  shopId: number;
  isMaster: boolean;
}

export interface RouteResult {
  status?: number;
  headers?: Record<string, string>;
  raw?: boolean;
  body?: unknown;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  auth?: boolean;
  masterOnly?: boolean;
  bodyLimit?: number;
  handler: (ctx: RouteContext) => Promise<RouteResult | null> | RouteResult | null;
}

export interface Barber {
  id: number;
  shop_id?: number;
  name: string;
  phone: string | null;
  email: string | null;
  color: string | null;
  commission: number;
  active: number;
  created_at: string;
}

export interface BarberHours {
  id?: number;
  barber_id: number;
  weekday: number;
  is_working: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

export interface Service {
  id: number;
  shop_id?: number;
  name: string;
  price: number;
  duration_min: number;
  description: string | null;
  active: number;
  created_at: string;
}

export interface Client {
  id: number;
  shop_id?: number;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  created_at: string;
}

export interface BusinessHours {
  weekday: number;
  is_open: number | boolean;
  open_time: string;
  close_time: string;
  break_start: string | null;
  break_end: string | null;
}

export interface Closure {
  id: number;
  date: string;
  reason: string | null;
}

export interface Appointment {
  id: number;
  shop_id?: number;
  client_id: number;
  barber_id: number;
  service_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  price: number;
  payment_method?: string | null;
  notes: string | null;
  source: AppointmentSource;
  cancel_token?: string | null;
  created_at: string;
  updated_at: string | null;
  client_name?: string;
  client_phone?: string;
  client_email?: string | null;
  barber_name?: string;
  barber_color?: string | null;
  service_name?: string | null;
  service_duration?: number | null;
}

export interface SchemaMigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}
