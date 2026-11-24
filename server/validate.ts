// Validacao de entrada das rotas.

import { HttpError } from './http.js';
import { isValidDate, isValidStatus, isValidTime } from './time.js';
import type { AppointmentStatus } from './types.js';

export interface StringValidationOptions {
  min?: number;
  max?: number;
}

export interface NumberValidationOptions {
  min?: number;
  max?: number;
}

export function sanitizeText(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

export function requiredString(
  value: unknown,
  field: string,
  options: StringValidationOptions = {}
): string {
  const { min = 1, max = 255 } = options;
  const text = sanitizeText(value);
  if (text.length < min) throw new HttpError(400, `Informe ${field}.`);
  if (text.length > max) {
    throw new HttpError(400, `O campo ${field} deve ter no maximo ${max} caracteres.`);
  }
  return text;
}

export function optionalString(value: unknown, field: string, max: number = 500): string | null {
  if (value === undefined || value === null) return null;
  const text = sanitizeText(value);
  if (!text) return null;
  if (text.length > max) {
    throw new HttpError(400, `O campo ${field} deve ter no maximo ${max} caracteres.`);
  }
  return text;
}

/** E-mail opcional com validacao simples de formato. */
export function optionalEmail(
  value: unknown,
  field: string = 'e-mail',
  max: number = 120
): string | null {
  const text = optionalString(value, field, max);
  if (!text) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
    throw new HttpError(400, `Informe um ${field} valido.`);
  }
  return text.toLowerCase();
}

export function requiredId(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, `Informe ${field}.`);
  return number;
}

export function optionalId(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredId(value, field);
}

export function requiredDate(value: unknown, field: string = 'data'): string {
  if (!isValidDate(value)) throw new HttpError(400, `Informe uma ${field} valida (AAAA-MM-DD).`);
  return String(value);
}

export function optionalDate(value: unknown, field: string = 'data'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredDate(value, field);
}

export function requiredTime(value: unknown, field: string = 'horario'): string {
  if (!isValidTime(value)) throw new HttpError(400, `Informe um ${field} valido (HH:MM).`);
  return String(value);
}

export function optionalTime(value: unknown, field: string = 'horario'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredTime(value, field);
}

export function requiredNumber(
  value: unknown,
  field: string,
  options: NumberValidationOptions = {}
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new HttpError(400, `Informe ${field} valido.`);
  if (options.min !== undefined && number < options.min) {
    throw new HttpError(400, `O campo ${field} deve ser no minimo ${options.min}.`);
  }
  if (options.max !== undefined && number > options.max) {
    throw new HttpError(400, `O campo ${field} deve ser no maximo ${options.max}.`);
  }
  return number;
}

export function optionalNumber(
  value: unknown,
  field: string,
  options: NumberValidationOptions = {}
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredNumber(value, field, options);
}

export function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T {
  const text = String(value ?? '').trim();
  if (!(allowed as readonly string[]).includes(text)) {
    throw new HttpError(400, `Valor invalido para ${field}.`);
  }
  return text as T;
}

export function requiredStatus(value: unknown): AppointmentStatus {
  const text = String(value ?? '').trim();
  if (!isValidStatus(text)) throw new HttpError(400, 'Status de agendamento invalido.');
  return text;
}

export function boolFlag(value: unknown, fallback: number = 1): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).toLowerCase();
  if (['1', 'true', 'sim', 'yes'].includes(text)) return 1;
  if (['0', 'false', 'nao', 'no'].includes(text)) return 0;
  return fallback;
}

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}
