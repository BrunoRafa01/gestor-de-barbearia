// Camada de persistencia com dois drivers intercambiaveis:
//
//   "sqlite" -> node:sqlite  (arquivo local, zero dependencias)  -> desenvolvimento
//   "turso"  -> @libsql/client (Turso / libSQL, HTTP)            -> producao gratuita
//
// A escolha e automatica: se TURSO_DATABASE_URL estiver definida, usa o Turso.
// Assim o sistema roda 100% offline na maquina do desenvolvedor e, em producao,
// usa um banco duravel na nuvem (necessario porque o disco do plano gratuito do
// Render e efemero e seria apagado a cada deploy/reinicio).
//
// Toda a API publica deste modulo e assincrona (exceto a leitura de configuracoes,
// que vem de um cache em memoria carregado no boot).

import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS business_hours (
  weekday     INTEGER PRIMARY KEY,
  is_open     INTEGER NOT NULL DEFAULT 1,
  open_time   TEXT    NOT NULL DEFAULT '09:00',
  close_time  TEXT    NOT NULL DEFAULT '19:00',
  break_start TEXT,
  break_end   TEXT
);

CREATE TABLE IF NOT EXISTS closures (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  date   TEXT NOT NULL UNIQUE,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS barbers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  color      TEXT,
  commission REAL NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS barber_hours (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  barber_id   INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL,
  is_working  INTEGER NOT NULL DEFAULT 1,
  start_time  TEXT NOT NULL DEFAULT '09:00',
  end_time    TEXT NOT NULL DEFAULT '19:00',
  break_start TEXT,
  break_end   TEXT,
  UNIQUE (barber_id, weekday)
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT,
  duration_min INTEGER NOT NULL DEFAULT 30,
  price        REAL NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  email      TEXT,
  birth_date TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  barber_id  INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  price      REAL NOT NULL DEFAULT 0,
  notes        TEXT,
  source       TEXT NOT NULL DEFAULT 'admin',
  cancel_token TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),
  CHECK (source IN ('admin','public'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_date        ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_barber_date ON appointments(barber_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_client      ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status      ON appointments(status);

-- Garante, no proprio banco, que nao existam dois agendamentos ativos
-- para o mesmo barbeiro no mesmo dia e com o mesmo horario inicial.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointment_slot
  ON appointments(barber_id, date, start_time)
  WHERE status IN ('pending','confirmed','completed');

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id  INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  recipient_type  TEXT NOT NULL DEFAULT 'client',
  recipient_phone TEXT NOT NULL,
  message_type    TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  content         TEXT,
  meta_message_id TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sent_at         TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_appt   ON whatsapp_messages(appointment_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone  ON whatsapp_messages(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(status);

-- Suporte Multi-tenant e Customizacao por Barbearia (/b/:slug)
CREATE TABLE IF NOT EXISTS barbershops (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  company       TEXT DEFAULT 'Nova Runtime',
  description   TEXT,
  logo_url      TEXT,
  cover_url     TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  address       TEXT,
  instagram     TEXT,
  primary_color TEXT DEFAULT '#3B82F6',
  accent_color  TEXT DEFAULT '#60A5FA',
  cuts_gallery  TEXT DEFAULT '[]',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_barbershops_slug ON barbershops(slug);

-- Avaliacoes Verificadas e Politica de Reputacao Autentica
CREATE TABLE IF NOT EXISTS reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_slug      TEXT DEFAULT 'nova-barbearia',
  appointment_id INTEGER REFERENCES appointments(id),
  barber_id      INTEGER REFERENCES barbers(id),
  client_name    TEXT NOT NULL,
  rating         INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment        TEXT,
  verified       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_shop ON reviews(shop_slug);
`;

export const DEFAULT_SETTINGS = {
  shop_name: 'Gestor de Barbearia',
  shop_company: 'Nova Runtime',
  shop_phone: '',
  shop_whatsapp: '',
  shop_address: '',
  shop_instagram: '',
  slot_interval: '15',
  min_advance_minutes: '60',
  max_advance_days: '60',
  public_booking: '1',
  whatsapp_country_code: '55',
  whatsapp_cloud_enabled: '0',
  whatsapp_phone_number_id: '',
  whatsapp_business_account_id: '',
  whatsapp_access_token: '',
  whatsapp_admin_phone: '',
  whatsapp_notify_admin: '1',
  whatsapp_notify_barber: '1',
  whatsapp_reminder_enabled: '1',
  whatsapp_reminder_hours: '24',
  whatsapp_api_version: 'v21.0',
  whatsapp_use_templates: '0',
  whatsapp_template_confirmation: 'confirmacao_agendamento',
  whatsapp_template_reminder: 'lembrete_agendamento',
  whatsapp_template_cancellation: 'cancelamento_agendamento',
  whatsapp_webhook_verify_token: '',
};

export const DEFAULT_BUSINESS_HOURS = [
  { weekday: 0, is_open: 0, open_time: '09:00', close_time: '18:00' },
  { weekday: 1, is_open: 1, open_time: '09:00', close_time: '19:00' },
  { weekday: 2, is_open: 1, open_time: '09:00', close_time: '19:00' },
  { weekday: 3, is_open: 1, open_time: '09:00', close_time: '19:00' },
  { weekday: 4, is_open: 1, open_time: '09:00', close_time: '19:00' },
  { weekday: 5, is_open: 1, open_time: '09:00', close_time: '20:00' },
  { weekday: 6, is_open: 1, open_time: '08:00', close_time: '18:00' },
];

/* --------------------------------------------------------------------------
 * Normalizacao de parametros e linhas
 * ------------------------------------------------------------------------ */

/** Converte valores que os drivers nao aceitam diretamente (undefined/boolean). */
function normalizeParams(params = []) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

/** Converte BigInt (Turso/libSQL) para Number e descarta prototipos estranhos. */
function normalizeRow(row) {
  if (!row) return null;
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    output[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return output;
}

function toRunResult(info = {}) {
  return {
    changes: Number(info.changes ?? info.rowsAffected ?? 0),
    lastInsertRowid: Number(info.lastInsertRowid ?? 0),
  };
}

/* --------------------------------------------------------------------------
 * Driver 1: node:sqlite (arquivo local)
 * ------------------------------------------------------------------------ */

async function createSqliteDriver(filePath) {
  const { DatabaseSync } = await import('node:sqlite');

  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true });

  const connection = new DatabaseSync(absolute);
  const pragma = (sql) => {
    try {
      connection.exec(sql);
    } catch {
      /* pragma nao suportado neste runtime - segue sem ele */
    }
  };
  pragma('PRAGMA journal_mode = WAL;');
  pragma('PRAGMA foreign_keys = ON;');
  pragma('PRAGMA busy_timeout = 5000;');

  return {
    kind: 'sqlite',
    label: absolute,
    ephemeral: false,

    async exec(sql) {
      connection.exec(sql);
    },

    async all(sql, params) {
      return connection
        .prepare(sql)
        .all(...normalizeParams(params))
        .map(normalizeRow);
    },

    async get(sql, params) {
      const row = connection.prepare(sql).get(...normalizeParams(params));
      return row === undefined ? null : normalizeRow(row);
    },

    async run(sql, params) {
      return toRunResult(connection.prepare(sql).run(...normalizeParams(params)));
    },

    /** Executa varias instrucoes de forma atomica (BEGIN IMMEDIATE / COMMIT). */
    async batch(statements) {
      const results = [];
      connection.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) {
          results.push(
            toRunResult(
              connection.prepare(statement.sql).run(...normalizeParams(statement.params || []))
            )
          );
        }
        connection.exec('COMMIT');
      } catch (error) {
        try {
          connection.exec('ROLLBACK');
        } catch {
          /* transacao ja encerrada */
        }
        throw error;
      }
      return results;
    },

    async close() {
      connection.close();
    },
  };
}

/* --------------------------------------------------------------------------
 * Driver 2: Turso / libSQL (remoto, duravel)
 * ------------------------------------------------------------------------ */

async function createTursoDriver(url, authToken) {
  let createClient;
  try {
    ({ createClient } = await import('@libsql/client'));
  } catch {
    throw new Error(
      'O pacote "@libsql/client" nao esta instalado. Rode "npm install" para usar o modo Turso.'
    );
  }

  const client = createClient({ url, authToken });

  return {
    kind: 'turso',
    label: url.replace(/\/\/([^.]+)\./, '//$1.***.'),
    ephemeral: false,

    async exec(sql) {
      await client.executeMultiple(sql);
    },

    async all(sql, params) {
      const result = await client.execute({ sql, args: normalizeParams(params) });
      return result.rows.map(normalizeRow);
    },

    async get(sql, params) {
      const result = await client.execute({ sql, args: normalizeParams(params) });
      return result.rows.length ? normalizeRow(result.rows[0]) : null;
    },

    async run(sql, params) {
      const result = await client.execute({ sql, args: normalizeParams(params) });
      return toRunResult({
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      });
    },

    /** `client.batch` com modo "write" e atomico no libSQL. */
    async batch(statements) {
      const results = await client.batch(
        statements.map((statement) => ({
          sql: statement.sql,
          args: normalizeParams(statement.params || []),
        })),
        'write'
      );
      return results.map((result) =>
        toRunResult({ changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid })
      );
    },

    async close() {
      client.close();
    },
  };
}

/* --------------------------------------------------------------------------
 * Estado interno
 * ------------------------------------------------------------------------ */

let driver = null;
let settingsCache = new Map();
let initialized = false;

function requireDriver() {
  if (!driver) throw new Error('Banco de dados nao inicializado. Chame initDatabase() antes.');
  return driver;
}

/* --------------------------------------------------------------------------
 * Inicializacao
 * ------------------------------------------------------------------------ */

/**
 * Inicializa a persistencia, cria o schema e carrega o cache de configuracoes.
 * @param {{ path?: string, url?: string, authToken?: string }} [options]
 */
export async function initDatabase(options = {}) {
  const url = options.url ?? process.env.TURSO_DATABASE_URL ?? '';
  const authToken = options.authToken ?? process.env.TURSO_AUTH_TOKEN ?? '';

  if (url) {
    // URLs "file:" sao bancos libSQL locais (usados pelos testes) e nao exigem token.
    const needsToken = !url.startsWith('file:');
    if (needsToken && !authToken) {
      throw new Error(
        'TURSO_DATABASE_URL definido, mas TURSO_AUTH_TOKEN esta vazio. Informe o token de acesso.'
      );
    }
    driver = await createTursoDriver(url, authToken);
  } else {
    const filePath = options.path ?? process.env.DATABASE_PATH ?? 'data/barbearia.db';
    driver = await createSqliteDriver(filePath);
  }

  await driver.exec(SCHEMA);

  // Migracao segura de schema para bancos preexistentes
  try {
    const tableCols = await driver.all('PRAGMA table_info(appointments)', []);
    const colNames = tableCols.map((col) => col.name);
    if (!colNames.includes('cancel_token')) {
      await driver.exec('ALTER TABLE appointments ADD COLUMN cancel_token TEXT');
    }
    if (!colNames.includes('payment_method')) {
      await driver.exec("ALTER TABLE appointments ADD COLUMN payment_method TEXT DEFAULT 'presencial'");
    }
    if (!colNames.includes('paid_at')) {
      await driver.exec('ALTER TABLE appointments ADD COLUMN paid_at TEXT');
    }
    await driver.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_cancel_token ON appointments(cancel_token) WHERE cancel_token IS NOT NULL'
    );
  } catch {
    /* coluna ou indice ja existente */
  }

  try {
    const barberCols = await driver.all('PRAGMA table_info(barbers)', []);
    const bNames = barberCols.map((col) => col.name);
    if (!bNames.includes('specialties')) {
      await driver.exec("ALTER TABLE barbers ADD COLUMN specialties TEXT DEFAULT 'Degradê, Barba, Tesoura'");
    }
    if (!bNames.includes('bio')) {
      await driver.exec("ALTER TABLE barbers ADD COLUMN bio TEXT DEFAULT 'Mestre barbeiro com foco em visagismo e pontualidade.'");
    }
    if (!bNames.includes('rating')) {
      await driver.exec('ALTER TABLE barbers ADD COLUMN rating REAL DEFAULT 4.9');
    }
    if (!bNames.includes('avatar_url')) {
      await driver.exec("ALTER TABLE barbers ADD COLUMN avatar_url TEXT DEFAULT ''");
    }
  } catch {
    /* colunas ja existentes */
  }

  try {
    const serviceCols = await driver.all('PRAGMA table_info(services)', []);
    const sNames = serviceCols.map((col) => col.name);
    if (!sNames.includes('category')) {
      await driver.exec("ALTER TABLE services ADD COLUMN category TEXT DEFAULT 'Cabelo'");
    }
  } catch {
    /* coluna ja existente */
  }

  await seedDefaults();
  await loadSettings();
  initialized = true;
  return driver;
}

async function seedDefaults() {
  const statements = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
    params: [key, String(value)],
  }));

  // Segredo usado para assinar a sessao do painel (gerado uma unica vez).
  statements.push({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
    params: ['session_secret', randomBytes(32).toString('hex')],
  });

  await driver.batch(statements);

  const total = await driver.get('SELECT COUNT(*) AS total FROM business_hours', []);
  if (Number(total?.total || 0) === 0) {
    await driver.batch(
      DEFAULT_BUSINESS_HOURS.map((row) => ({
        sql: `INSERT INTO business_hours (weekday, is_open, open_time, close_time, break_start, break_end)
              VALUES (?, ?, ?, ?, NULL, NULL)`,
        params: [row.weekday, row.is_open, row.open_time, row.close_time],
      }))
    );
  }

  // Semeia barbearias multi-tenant caso a tabela esteja vazia
  const totalShops = await driver.get('SELECT COUNT(*) AS total FROM barbershops', []);
  if (Number(totalShops?.total || 0) === 0) {
    const defaultCuts = JSON.stringify([
      { title: 'Degradê Navalhado', desc: 'Acabamento milimétrico na navalha e contorno alinhado', tag: 'Cabelo' },
      { title: 'Barboterapia & Toalha Quente', desc: 'Aroma suave, hidratação profunda e lâmina afiada', tag: 'Barba' },
      { title: 'Corte Social Moderno', desc: 'Tesoura e acabamento executivo impecável', tag: 'Clássico' },
      { title: 'Platinado & Texturizado', desc: 'Descoloração segura e pomada matte', tag: 'Estilo' },
    ]);

    await driver.batch([
      {
        sql: `INSERT INTO barbershops (slug, name, company, description, phone, whatsapp, address, instagram, primary_color, cuts_gallery, active)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT(slug) DO NOTHING`,
        params: [
          'nova-barbearia',
          'Nova Barbearia',
          'Nova Runtime',
          'Ambiente sofisticado, pontualidade e mestres barbeiros especializados em degradê, corte clássico e barboterapia.',
          '(11) 98765-4321',
          '11987654321',
          'Av. Paulista, 1106 - Bela Vista, São Paulo - SP',
          '@novabarbearia.oficial',
          '#3B82F6',
          defaultCuts,
        ],
      },
      {
        sql: `INSERT INTO barbershops (slug, name, company, description, phone, whatsapp, address, instagram, primary_color, cuts_gallery, active)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT(slug) DO NOTHING`,
        params: [
          'barbearia-premium',
          'Barbearia Premium Club',
          'Nova Runtime',
          'Espaço exclusivo para cavalheiros exigentes com café espresso, cerveja artesanal e atendimento personalizado.',
          '(11) 91234-5678',
          '11912345678',
          'Rua Oscar Freire, 800 - Jardins, São Paulo - SP',
          '@barbeariapremium.sp',
          '#3B82F6',
          defaultCuts,
        ],
      },
    ]);
  }

  // Semeia reviews verificadas de demonstração
  const totalReviews = await driver.get('SELECT COUNT(*) AS total FROM reviews', []);
  if (Number(totalReviews?.total || 0) === 0) {
    await driver.batch([
      {
        sql: `INSERT INTO reviews (shop_slug, client_name, rating, comment, verified) VALUES (?, ?, ?, ?, 1)`,
        params: ['nova-barbearia', 'Lucas Mendes', 5, 'Melhor atendimento de SP. Pontualidade britânica e o degradê ficou impecável!'],
      },
      {
        sql: `INSERT INTO reviews (shop_slug, client_name, rating, comment, verified) VALUES (?, ?, ?, ?, 1)`,
        params: ['nova-barbearia', 'Rafael Silveira', 5, 'A barboterapia com toalha quente relaxa demais. Ambiente de altíssimo padrão.'],
      },
      {
        sql: `INSERT INTO reviews (shop_slug, client_name, rating, comment, verified) VALUES (?, ?, ?, ?, 1)`,
        params: ['nova-barbearia', 'Guilherme Castro', 5, 'Agendamento super fácil pelo Instagram, sem precisar baixar nada. Recomendo muito!'],
      },
    ]);
  }
}

/* --------------------------------------------------------------------------
 * API de consulta
 * ------------------------------------------------------------------------ */

/** Executa um SELECT e devolve todas as linhas. */
export function all(sql, params = []) {
  return requireDriver().all(sql, params);
}

/** Executa um SELECT e devolve a primeira linha (ou null). */
export function get(sql, params = []) {
  return requireDriver().get(sql, params);
}

/** Executa um INSERT/UPDATE/DELETE e devolve { changes, lastInsertRowid }. */
export function run(sql, params = []) {
  return requireDriver().run(sql, params);
}

/** Executa varias instrucoes de escrita de forma atomica. */
export function batch(statements = []) {
  return requireDriver().batch(statements);
}

/** Executa SQL livre (multiplas instrucoes). */
export function exec(sql) {
  return requireDriver().exec(sql);
}

/* --------------------------------------------------------------------------
 * Configuracoes (cache em memoria, leitura sincrona)
 * ------------------------------------------------------------------------ */

export async function loadSettings() {
  const rows = await requireDriver().all('SELECT key, value FROM settings', []);
  settingsCache = new Map(rows.map((row) => [row.key, row.value]));
  return settingsCache;
}

export function getSettingsMap() {
  return Object.fromEntries(settingsCache.entries());
}

export function getSetting(key, fallback = null) {
  const value = settingsCache.get(key);
  return value === undefined ? fallback : value;
}

export async function setSetting(key, value) {
  const normalized = value === null || value === undefined ? null : String(value);
  await requireDriver().run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, normalized]
  );
  settingsCache.set(key, normalized);
  return normalized;
}

/* --------------------------------------------------------------------------
 * Diagnostico
 * ------------------------------------------------------------------------ */

export function driverKind() {
  return driver ? driver.kind : 'none';
}

export function driverLabel() {
  return driver ? driver.label : '-';
}

export function isInitialized() {
  return initialized;
}

export async function healthCheck() {
  const started = Date.now();
  try {
    await requireDriver().get('SELECT 1 AS ok', []);
    return {
      ok: true,
      driver: driver.kind,
      target: driver.label,
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      driver: driver ? driver.kind : 'none',
      target: driver ? driver.label : null,
      latency_ms: Date.now() - started,
      error: String(error?.message || error),
    };
  }
}

export async function closeDatabase() {
  if (!driver) return;
  await driver.close();
  driver = null;
  initialized = false;
}

/* --------------------------------------------------------------------------
 * Multi-barbearia & Reputacao
 * ------------------------------------------------------------------------ */

export async function getShopBySlug(slug = 'nova-barbearia') {
  const shop = await get('SELECT * FROM barbershops WHERE slug = ? AND active = 1', [slug]);
  if (!shop) {
    return await get('SELECT * FROM barbershops WHERE active = 1 ORDER BY id ASC LIMIT 1', []);
  }
  return shop;
}

export async function listShops() {
  return await all('SELECT id, slug, name, company, description, logo_url, address, instagram, whatsapp FROM barbershops WHERE active = 1 ORDER BY name ASC', []);
}

export async function getShopReviews(slug = 'nova-barbearia') {
  return await all('SELECT id, client_name, rating, comment, verified, created_at FROM reviews WHERE shop_slug = ? ORDER BY id DESC LIMIT 20', [slug]);
}

export async function addReview({ shopSlug = 'nova-barbearia', clientName, rating, comment, appointmentId, barberId }) {
  return await run(
    'INSERT INTO reviews (shop_slug, client_name, rating, comment, appointment_id, barber_id, verified) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [shopSlug, clientName, Number(rating), comment || '', appointmentId || null, barberId || null]
  );
}
