// Integracao com WhatsApp via links oficiais "click to chat" (wa.me).
// Nao depende de credenciais: abre o WhatsApp Web/App com a mensagem pronta.
// Para envio automatico em massa, e possivel plugar depois a WhatsApp Cloud API
// usando as mesmas mensagens geradas aqui.

import { getSetting } from './db.js';
import { formatDateBR } from './time.js';

export function normalizePhone(raw, countryCode = null) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return '';
  const cc = String(countryCode || getSetting('whatsapp_country_code', '55') || '55');
  if (digits.startsWith(cc) && digits.length >= 12) return digits;
  if (digits.length <= 11) return `${cc}${digits}`;
  return digits;
}

export function formatPhoneBR(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw || '';
}

export function waLink(phone, message) {
  const number = normalizePhone(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function fillTemplate(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export const DEFAULT_TEMPLATES = {
  confirmation:
    'Olá {cliente}! Aqui é da {loja}. Seu horário está agendado para {data} às {hora} com {barbeiro} ({servico}). Podemos confirmar? Responda SIM para confirmar ou NÃO para cancelar.',
  reminder:
    'Oi {cliente}! Lembrete do seu horário na {loja}: {data} às {hora} com {barbeiro}. Esperamos você!',
  cancellation:
    'Olá {cliente}, seu horário na {loja} em {data} às {hora} foi cancelado. Se quiser, podemos reagendar.',
};

/** Monta as mensagens prontas para uma linha de agendamento. */
export function buildMessages(appointment, baseUrl = '') {
  const cancelLink = appointment.cancel_token
    ? `${baseUrl || ''}/agendar.html?cancel=${appointment.cancel_token}`
    : '';

  const values = {
    cliente: appointment.client_name || 'cliente',
    loja: appointment.shop_name || getSetting('shop_name', 'Gestor de Barbearia'),
    data: formatDateBR(appointment.date),
    hora: appointment.start_time,
    barbeiro: appointment.barber_name || 'nosso profissional',
    servico: appointment.service_name || 'atendimento',
    link_cancelamento: cancelLink,
  };

  const custom = {
    confirmation: getSetting('whatsapp_message_confirmation'),
    reminder: getSetting('whatsapp_message_reminder'),
    cancellation: getSetting('whatsapp_message_cancellation'),
  };

  const messages = {};
  for (const key of Object.keys(DEFAULT_TEMPLATES)) {
    messages[key] = fillTemplate(custom[key] || DEFAULT_TEMPLATES[key], values);
  }
  messages.values = values;
  return messages;
}
