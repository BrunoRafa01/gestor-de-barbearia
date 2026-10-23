// Validacao de entrada das rotas.

import { HttpError } from './http.js';
import { isValidDate, isValidTime, isValidStatus } from './time.js';

export function requiredString(value, field, options = {}) {
  const { min = 1, max = 255 } = options;
  const text = String(value ?? '').trim();
  if (text.length < min) throw new HttpError(400, `Informe ${field}.`);
  if (text.length > max) throw new HttpError(400, `O campo ${field} deve ter no maximo ${max} caracteres.`);
  return text;
}

export function optionalString(value, field, max = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new HttpError(400, `O campo ${field} deve ter no maximo ${max} caracteres.`);
  return text;
}

/** E-mail opcional com validacao simples de formato. */
export function optionalEmail(value, field = 'e-mail', max = 120) {
  const text = optionalString(value, field, max);
  if (!text) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
    throw new HttpError(400, `Informe um ${field} valido.`);
  }
  return text.toLowerCase();
}

export function requiredId(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, `Informe ${field}.`);
  return number;
}

export function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requiredId(value, field);
}

export function requiredDate(value, field = 'data') {
  if (!isValidDate(value)) throw new HttpError(400, `Informe uma ${field} valida (AAAA-MM-DD).`);
  return String(value);
}

export function optionalDate(value, field = 'data') {
  if (value === undefined || value === null || value === '') return null;
  return requiredDate(value, field);
}

export function requiredTime(value, field = 'horario') {
  if (!isValidTime(value)) throw new HttpError(400, `Informe um ${field} valido (HH:MM).`);
  return String(value);
}

export function optionalTime(value, field = 'horario') {
  if (value === undefined || value === null || value === '') return null;
  return requiredTime(value, field);
}

export function requiredNumber(value, field, options = {}) {
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

export function optionalNumber(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requiredNumber(value, field, options);
}

export function requiredEnum(value, allowed, field) {
  const text = String(value ?? '').trim();
  if (!allowed.includes(text)) {
    throw new HttpError(400, `Valor invalido para ${field}.`);
  }
  return text;
}

export function requiredStatus(value) {
  const text = String(value ?? '').trim();
  if (!isValidStatus(text)) throw new HttpError(400, 'Status de agendamento invalido.');
  return text;
}

export function boolFlag(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).toLowerCase();
  if (['1', 'true', 'sim', 'yes'].includes(text)) return 1;
  if (['0', 'false', 'nao', 'no'].includes(text)) return 0;
  return fallback;
}

export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}
