import { DEFAULT_SETTINGS, all, batch, get, getSettingsMap, run, setSetting } from '../db.js';
import { invalidateBusinessHours, invalidateClosures } from '../availability.js';
import { HttpError } from '../http.js';
import { hashPassword, isAuthenticated, passwordIssue, verifyPassword } from '../auth.js';
import {
  digitsOnly,
  optionalString,
  requiredDate,
  requiredId,
  requiredNumber,
  requiredString,
} from '../validate.js';
import { WEEKDAYS } from '../time.js';

const SECRET_KEYS = ['session_secret', 'admin_password_hash', 'admin_password_default'];

const EDITABLE_KEYS = Object.keys(DEFAULT_SETTINGS).concat([
  'whatsapp_message_confirmation',
  'whatsapp_message_reminder',
  'whatsapp_message_cancellation',
]);

/** Normaliza e valida cada chave editavel antes de gravar. */
function normalizeSetting(key, value) {
  switch (key) {
    case 'shop_name':
      return requiredString(value, 'nome da barbearia', { max: 120 });
    case 'shop_company':
      return requiredString(value, 'empresa', { max: 120 });
    case 'shop_phone':
      return optionalString(value, 'telefone', 30) || '';
    case 'shop_whatsapp':
      return optionalString(value, 'WhatsApp', 30) || '';
    case 'shop_address':
      return optionalString(value, 'endereco', 200) || '';
    case 'shop_instagram':
      return optionalString(value, 'Instagram', 60) || '';
    case 'slot_interval':
      return String(Math.round(requiredNumber(value, 'intervalo entre horarios', { min: 5, max: 120 })));
    case 'min_advance_minutes':
      return String(Math.round(requiredNumber(value, 'antecedencia minima', { min: 0, max: 10080 })));
    case 'max_advance_days':
      return String(Math.round(requiredNumber(value, 'antecedencia maxima', { min: 1, max: 365 })));
    case 'public_booking':
      return String(value) === '0' || value === false || value === 'false' ? '0' : '1';
    case 'whatsapp_country_code': {
      const code = digitsOnly(value);
      if (code.length < 1 || code.length > 4) {
        throw new HttpError(400, 'Informe um codigo de pais valido (ex.: 55).');
      }
      return code;
    }
    case 'whatsapp_message_confirmation':
    case 'whatsapp_message_reminder':
    case 'whatsapp_message_cancellation':
      return optionalString(value, 'mensagem do WhatsApp', 800) || '';
    default:
      return value === null || value === undefined ? '' : String(value).trim();
  }
}

function publicSettings() {
  const map = getSettingsMap();
  for (const key of SECRET_KEYS) delete map[key];
  return map;
}

function businessHoursPayload(rows) {
  return rows.map((row) => ({
    ...row,
    weekday: Number(row.weekday),
    is_open: Number(row.is_open),
    label: WEEKDAYS[Number(row.weekday)],
  }));
}

export const settingsRoutes = [
  {
    method: 'GET',
    path: '/api/settings',
    handler: () => ({ status: 200, body: publicSettings() }),
  },
  {
    method: 'PUT',
    path: '/api/settings',
    handler: async ({ body }) => {
      const entries = Object.entries(body || {}).filter(([key]) => EDITABLE_KEYS.includes(key));

      // Valida tudo antes de gravar, para nao deixar configuracao parcial.
      const normalized = entries.map(([key, value]) => [key, normalizeSetting(key, value)]);

      for (const [key, value] of normalized) {
        await setSetting(key, value);
      }

      return { status: 200, body: publicSettings() };
    },
  },
  {
    method: 'POST',
    path: '/api/settings/password',
    handler: async ({ req, body }) => {
      const current = requiredString(body.current_password, 'senha atual', { max: 128 });
      const next = requiredString(body.new_password, 'nova senha', { max: 128 });

      const issue = passwordIssue(next);
      if (issue) throw new HttpError(400, issue);
      if (next === current) {
        throw new HttpError(400, 'A nova senha deve ser diferente da senha atual.');
      }

      const stored = getSettingsMap().admin_password_hash;
      if (!verifyPassword(current, stored)) throw new HttpError(400, 'Senha atual incorreta.');

      await setSetting('admin_password_hash', hashPassword(next));
      await setSetting('admin_password_default', '0');

      return { status: 200, body: { updated: true, authenticated: isAuthenticated(req) } };
    },
  },
  {
    method: 'GET',
    path: '/api/business-hours',
    handler: async () => {
      const rows = await all('SELECT * FROM business_hours ORDER BY weekday', []);
      return { status: 200, body: businessHoursPayload(rows) };
    },
  },
  {
    method: 'PUT',
    path: '/api/business-hours',
    handler: async ({ body }) => {
      const days = Array.isArray(body.days) ? body.days : [];
      if (!days.length) throw new HttpError(400, 'Informe os dias de funcionamento.');

      const statements = [];

      for (const day of days) {
        const weekday = Number(day.weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;

        const isOpen = day.is_open === false || String(day.is_open) === '0' ? 0 : 1;
        const openTime = optionalString(day.open_time, 'hora de abertura', 5) || '09:00';
        const closeTime = optionalString(day.close_time, 'hora de fechamento', 5) || '19:00';
        const breakStart = optionalString(day.break_start, 'inicio do intervalo', 5);
        const breakEnd = optionalString(day.break_end, 'fim do intervalo', 5);

        if (!/^\d{2}:\d{2}$/.test(openTime) || !/^\d{2}:\d{2}$/.test(closeTime)) {
          throw new HttpError(400, `No ${WEEKDAYS[weekday]} informe horarios no formato HH:MM.`);
        }
        if (isOpen && closeTime <= openTime) {
          throw new HttpError(
            400,
            `No ${WEEKDAYS[weekday]} o horario de fechamento deve ser maior que o de abertura.`
          );
        }
        if ((breakStart === null) !== (breakEnd === null)) {
          throw new HttpError(
            400,
            `No ${WEEKDAYS[weekday]} informe o inicio e o fim do intervalo, ou deixe ambos vazios.`
          );
        }
        if (isOpen && breakStart && breakEnd && (breakEnd <= breakStart || breakStart < openTime || breakEnd > closeTime)) {
          throw new HttpError(
            400,
            `No ${WEEKDAYS[weekday]} o intervalo deve estar dentro do horario de funcionamento.`
          );
        }

        statements.push({
          sql: `UPDATE business_hours
                   SET is_open = ?, open_time = ?, close_time = ?, break_start = ?, break_end = ?
                 WHERE weekday = ?`,
          params: [isOpen, openTime, closeTime, breakStart, breakEnd, weekday],
        });
      }

      if (statements.length) await batch(statements);
      invalidateBusinessHours();

      const rows = await all('SELECT * FROM business_hours ORDER BY weekday', []);
      return { status: 200, body: businessHoursPayload(rows) };
    },
  },
  {
    method: 'GET',
    path: '/api/closures',
    handler: async () => {
      const rows = await all('SELECT * FROM closures ORDER BY date ASC', []);
      return { status: 200, body: rows };
    },
  },
  {
    method: 'POST',
    path: '/api/closures',
    handler: async ({ body }) => {
      const date = requiredDate(body.date, 'data da folga');
      const reason = optionalString(body.reason, 'motivo', 120);

      const active = await get(
        `SELECT COUNT(*) AS total FROM appointments
          WHERE date = ? AND status IN ('pending','confirmed')`,
        [date]
      );

      if (Number(active?.total || 0) > 0) {
        throw new HttpError(
          409,
          'Existem agendamentos ativos nesta data. Cancele ou remaneje antes de marcar a folga.'
        );
      }

      const existing = await get('SELECT id FROM closures WHERE date = ?', [date]);
      if (existing) {
        throw new HttpError(409, 'Ja existe uma folga cadastrada nesta data.');
      }

      const info = await run('INSERT INTO closures (date, reason) VALUES (?, ?)', [date, reason]);
      invalidateClosures();
      return {
        status: 201,
        body: await get('SELECT * FROM closures WHERE id = ?', [Number(info.lastInsertRowid)]),
      };
    },
  },
  {
    method: 'DELETE',
    path: '/api/closures/:id',
    handler: async ({ params }) => {
      const id = requiredId(params.id, 'folga');
      const existing = await get('SELECT id FROM closures WHERE id = ?', [id]);
      if (!existing) throw new HttpError(404, 'Folga nao encontrada.');
      await run('DELETE FROM closures WHERE id = ?', [id]);
      invalidateClosures();
      return { status: 200, body: { deleted: true, id } };
    },
  },
];
