// Integracao com WhatsApp via links oficiais "click to chat" (wa.me).
// Nao depende de credenciais: abre o WhatsApp Web/App com a mensagem pronta.
// Para envio automatico em massa, e possivel plugar depois a WhatsApp Cloud API
// usando as mesmas mensagens geradas aqui.

import { getSetting } from './db.js';
import { formatDateBR } from './time.js';

export type TemplateMessageKey = 'confirmation' | 'reminder' | 'cancellation';

export interface TemplateValues {
  cliente: string;
  loja: string;
  data: string;
  hora: string;
  barbeiro: string;
  servico: string;
  link_cancelamento: string;
  [key: string]: string;
}

export interface BuiltWhatsAppMessages {
  confirmation: string;
  reminder: string;
  cancellation: string;
  values: TemplateValues;
}

export interface WhatsAppAppointmentInput {
  date?: string | null;
  start_time?: string | null;
  client_name?: string | null;
  shop_name?: string | null;
  barber_name?: string | null;
  service_name?: string | null;
  cancel_token?: string | null;
}

export function normalizePhone(
  raw: string | null | undefined,
  countryCode: string | null = null
): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return '';
  const cc = String(countryCode || getSetting('whatsapp_country_code', '55') || '55');
  if (digits.startsWith(cc) && digits.length >= 12) return digits;
  if (digits.length <= 11) return `${cc}${digits}`;
  return digits;
}

export function formatPhoneBR(raw: string | null | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return raw || '';
}

export function waLink(phone: string | null | undefined, message: string): string | null {
  const number = normalizePhone(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function fillTemplate(
  template: string | null | undefined,
  values: Record<string, string | number | null | undefined>
): string {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export const DEFAULT_TEMPLATES: Readonly<Record<TemplateMessageKey, string>> = {
  confirmation:
    'Olá {cliente}! Aqui é da {loja}. Seu horário está agendado para {data} às {hora} com {barbeiro} ({servico}). Podemos confirmar? Responda SIM para confirmar ou NÃO para cancelar.',
  reminder:
    'Oi {cliente}! Lembrete do seu horário na {loja}: {data} às {hora} com {barbeiro}. Esperamos você!',
  cancellation:
    'Olá {cliente}, seu horário na {loja} em {data} às {hora} foi cancelado. Se quiser, podemos reagendar.',
};

/** Monta as mensagens prontas para uma linha de agendamento. */
export function buildMessages(
  appointment: WhatsAppAppointmentInput,
  baseUrl: string = ''
): BuiltWhatsAppMessages {
  const cancelLink = appointment.cancel_token
    ? `${baseUrl || ''}/agendar.html?cancel=${appointment.cancel_token}`
    : '';

  const values: TemplateValues = {
    cliente: appointment.client_name || 'cliente',
    loja: appointment.shop_name || getSetting('shop_name', 'Gestor de Barbearia'),
    data: formatDateBR(appointment.date),
    hora: appointment.start_time || '',
    barbeiro: appointment.barber_name || 'nosso profissional',
    servico: appointment.service_name || 'atendimento',
    link_cancelamento: cancelLink,
  };

  const custom: Record<TemplateMessageKey, string | null> = {
    confirmation: getSetting('whatsapp_message_confirmation'),
    reminder: getSetting('whatsapp_message_reminder'),
    cancellation: getSetting('whatsapp_message_cancellation'),
  };

  return {
    confirmation: fillTemplate(custom.confirmation || DEFAULT_TEMPLATES.confirmation, values),
    reminder: fillTemplate(custom.reminder || DEFAULT_TEMPLATES.reminder, values),
    cancellation: fillTemplate(custom.cancellation || DEFAULT_TEMPLATES.cancellation, values),
    values,
  };
}
