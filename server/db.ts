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
import { dirname, join, resolve } from 'node:path';
import { DATA_DIR } from './paths.js';
import type {
  BatchStatement,
  DbRow,
  DbRunResult,
  SchemaMigrationRecord,
  SqlParam,
} from './types.js';

export type DriverKind = 'sqlite' | 'turso' | 'none';

export interface DbDriver {
  kind: 'sqlite' | 'turso';
  label: string;
  ephemeral: boolean;
  exec(sql: string): Promise<void>;
  all(sql: string, params?: readonly unknown[]): Promise<DbRow[]>;
  get(sql: string, params?: readonly unknown[]): Promise<DbRow | null>;
  run(sql: string, params?: readonly unknown[]): Promise<DbRunResult>;
  batch(statements: readonly BatchStatement[]): Promise<DbRunResult[]>;
  close(): Promise<void>;
}

export interface InitDatabaseOptions {
  path?: string;
  url?: string;
  authToken?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  driver: DriverKind;
  target: string | null;
  latency_ms: number;
  error?: string;
}

export interface AddReviewInput {
  shopSlug?: string;
  clientName: string;
  rating: number;
  comment?: string | null;
  appointmentId?: number | null;
  barberId?: number | null;
}

interface SchemaMigration {
  version: number;
  name: string;
  up: (drv: DbDriver) => Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL DEFAULT 1,
  date    TEXT NOT NULL UNIQUE,
  reason  TEXT
);

CREATE TABLE IF NOT EXISTS barbers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL DEFAULT 1,
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
  shop_id      INTEGER NOT NULL DEFAULT 1,
  name         TEXT NOT NULL,
  description  TEXT,
  duration_min INTEGER NOT NULL DEFAULT 30,
  price        REAL NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL DEFAULT 1,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  email      TEXT,
  birth_date TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_clients_shop_phone ON clients(shop_id, phone);

CREATE TABLE IF NOT EXISTS appointments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id        INTEGER NOT NULL DEFAULT 1,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  barber_id      INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  service_id     INTEGER NOT NULL REFERENCES services(id),
  date           TEXT NOT NULL,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  price          REAL NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'pix',
  paid_at        TEXT,
  notes          TEXT,
  source         TEXT NOT NULL DEFAULT 'admin',
  cancel_token   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),
  CHECK (source IN ('admin','public'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_date             ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_barber_date      ON appointments(barber_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_client           ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status           ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_shop_date_status ON appointments(shop_id, date, status);

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

-- Bloqueios parciais de horario (por profissional ou barbearia)
CREATE TABLE IF NOT EXISTS barber_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL DEFAULT 1,
  barber_id  INTEGER REFERENCES barbers(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_barber_blocks_date ON barber_blocks(shop_id, date, barber_id);

-- Usuarios multi-tenant (donos / equipe por barbearia)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id       INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);

-- Planos e Assinaturas SaaS
CREATE TABLE IF NOT EXISTS plans (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  price_cents      INTEGER NOT NULL DEFAULT 0,
  max_barbers      INTEGER NOT NULL DEFAULT 2,
  max_services     INTEGER NOT NULL DEFAULT 10,
  whatsapp_cloud   INTEGER NOT NULL DEFAULT 0,
  reports_advanced INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
  shop_id            INTEGER PRIMARY KEY REFERENCES barbershops(id) ON DELETE CASCADE,
  plan_id            TEXT NOT NULL REFERENCES plans(id),
  status             TEXT NOT NULL DEFAULT 'active',
  provider           TEXT,
  external_id        TEXT,
  current_period_end TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id        INTEGER NOT NULL DEFAULT 1,
  description    TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'Geral',
  amount         REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'pix',
  date           TEXT NOT NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_shop_date ON expenses(shop_id, date);

CREATE TABLE IF NOT EXISTS shop_settings (
  shop_id    INTEGER NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (shop_id, key)
);
`;

export const DEFAULT_SETTINGS: Record<string, string> = {
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

export interface DefaultBusinessHourRow {
  weekday: number;
  is_open: number;
  open_time: string;
  close_time: string;
}

export const DEFAULT_BUSINESS_HOURS: readonly DefaultBusinessHourRow[] = [
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
function normalizeParams(params: readonly unknown[] = []): SqlParam[] {
  return params.map((value): SqlParam => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
      return value;
    }
    if (value instanceof Uint8Array) return value;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  });
}

/** Converte BigInt (Turso/libSQL) para Number e descarta prototipos estranhos. */
function normalizeRow(row: Record<string, unknown> | null | undefined): DbRow | null {
  if (!row) return null;
  const output: DbRow = {};
  for (const [key, value] of Object.entries(row)) {
    output[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return output;
}

function toRunResult(info: {
  changes?: number | bigint;
  rowsAffected?: number | bigint;
  lastInsertRowid?: number | bigint;
} = {}): DbRunResult {
  return {
    changes: Number(info.changes ?? info.rowsAffected ?? 0),
    lastInsertRowid: Number(info.lastInsertRowid ?? 0),
  };
}

/* --------------------------------------------------------------------------
 * Driver 1: node:sqlite (arquivo local)
 * ------------------------------------------------------------------------ */

async function createSqliteDriver(filePath: string): Promise<DbDriver> {
  const { DatabaseSync } = await import('node:sqlite');

  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true });

  const connection = new DatabaseSync(absolute);
  const pragma = (sql: string): void => {
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

    async exec(sql: string): Promise<void> {
      connection.exec(sql);
    },

    async all(sql: string, params: readonly unknown[] = []): Promise<DbRow[]> {
      const rows = connection.prepare(sql).all(...normalizeParams(params)) as Array<
        Record<string, unknown>
      >;
      return rows.map((row) => normalizeRow(row) ?? {});
    },

    async get(sql: string, params: readonly unknown[] = []): Promise<DbRow | null> {
      const row = connection.prepare(sql).get(...normalizeParams(params)) as
        | Record<string, unknown>
        | undefined;
      return row === undefined ? null : normalizeRow(row);
    },

    async run(sql: string, params: readonly unknown[] = []): Promise<DbRunResult> {
      return toRunResult(connection.prepare(sql).run(...normalizeParams(params)));
    },

    /** Executa varias instrucoes de forma atomica (BEGIN IMMEDIATE / COMMIT). */
    async batch(statements: readonly BatchStatement[]): Promise<DbRunResult[]> {
      const results: DbRunResult[] = [];
      connection.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) {
          results.push(
            toRunResult(
              connection.prepare(statement.sql).run(...normalizeParams(statement.params ?? []))
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

    async close(): Promise<void> {
      connection.close();
    },
  };
}

/* --------------------------------------------------------------------------
 * Driver 2: Turso / libSQL (remoto, duravel)
 * ------------------------------------------------------------------------ */

async function createTursoDriver(url: string, authToken: string): Promise<DbDriver> {
  let createClient: typeof import('@libsql/client').createClient;
  try {
    ({ createClient } = await import('@libsql/client'));
  } catch {
    throw new Error(
      'O pacote "@libsql/client" nao esta instalado. Rode "npm install" para usar o modo Turso.'
    );
  }

  const client = createClient({ url, authToken });
  try {
    await client.execute('PRAGMA foreign_keys = ON');
  } catch {
    /* opcional em conexoes HTTP */
  }

  return {
    kind: 'turso',
    label: url.replace(/\/\/([^.]+)\./, '//$1.***.'),
    ephemeral: false,

    async exec(sql: string): Promise<void> {
      await client.executeMultiple(sql);
    },

    async all(sql: string, params: readonly unknown[] = []): Promise<DbRow[]> {
      const result = await client.execute({ sql, args: normalizeParams(params) });
      return result.rows.map((row) => normalizeRow(row as unknown as Record<string, unknown>) ?? {});
    },

    async get(sql: string, params: readonly unknown[] = []): Promise<DbRow | null> {
      const result = await client.execute({ sql, args: normalizeParams(params) });
      const first = result.rows[0] as unknown as Record<string, unknown> | undefined;
      return first ? normalizeRow(first) : null;
    },

    async run(sql: string, params: readonly unknown[] = []): Promise<DbRunResult> {
      const result = await client.execute({ sql, args: normalizeParams(params) });
      return toRunResult({
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      });
    },

    /** `client.batch` com modo "write" e atomico no libSQL. */
    async batch(statements: readonly BatchStatement[]): Promise<DbRunResult[]> {
      const results = await client.batch(
        statements.map((statement) => ({
          sql: statement.sql,
          args: normalizeParams(statement.params ?? []),
        })),
        'write'
      );
      return results.map((result) =>
        toRunResult({ changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid })
      );
    },

    async close(): Promise<void> {
      client.close();
    },
  };
}

/* --------------------------------------------------------------------------
 * Migracoes versionadas e idempotentes
 * ------------------------------------------------------------------------ */

async function ensureColumn(
  drv: DbDriver,
  table: string,
  column: string,
  definitionSql: string
): Promise<void> {
  try {
    const cols = await drv.all(`PRAGMA table_info(${table})`, []);
    const names = cols.map((col) => String(col['name'] ?? ''));
    if (!names.includes(column)) {
      await drv.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definitionSql}`);
    }
  } catch {
    /* coluna ja existente */
  }
}

const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: '001_appointments_extended_columns',
    async up(drv) {
      await ensureColumn(drv, 'appointments', 'cancel_token', 'TEXT');
      await ensureColumn(drv, 'appointments', 'payment_method', "TEXT DEFAULT 'pix'");
      await ensureColumn(drv, 'appointments', 'paid_at', 'TEXT');
      try {
        await drv.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_cancel_token ON appointments(cancel_token) WHERE cancel_token IS NOT NULL'
        );
      } catch {
        /* indice ja existente */
      }
    },
  },
  {
    version: 2,
    name: '002_barbers_and_services_profile_columns',
    async up(drv) {
      await ensureColumn(drv, 'barbers', 'specialties', "TEXT DEFAULT 'Degradê, Barba, Tesoura'");
      await ensureColumn(
        drv,
        'barbers',
        'bio',
        "TEXT DEFAULT 'Mestre barbeiro com foco em visagismo e pontualidade.'"
      );
      await ensureColumn(drv, 'barbers', 'rating', 'REAL DEFAULT 4.9');
      await ensureColumn(drv, 'barbers', 'avatar_url', "TEXT DEFAULT ''");
      await ensureColumn(drv, 'services', 'category', "TEXT DEFAULT 'Cabelo'");
    },
  },
  {
    version: 3,
    name: '003_multitenant_shop_id_columns',
    async up(drv) {
      for (const tbl of ['closures', 'barbers', 'services', 'clients', 'appointments']) {
        await ensureColumn(drv, tbl, 'shop_id', 'INTEGER NOT NULL DEFAULT 1');
      }
    },
  },
  {
    version: 4,
    name: '004_composite_performance_indexes',
    async up(drv) {
      await drv.exec(`
        CREATE INDEX IF NOT EXISTS idx_appointments_shop_date_status ON appointments(shop_id, date, status);
        CREATE INDEX IF NOT EXISTS idx_clients_shop_phone ON clients(shop_id, phone);
        CREATE INDEX IF NOT EXISTS idx_expenses_shop_date ON expenses(shop_id, date);
        CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_appt ON whatsapp_messages(appointment_id);
      `);
    },
  },
];

async function runSchemaMigrations(drv: DbDriver): Promise<void> {
  await drv.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = await drv.all('SELECT version FROM schema_migrations', []);
  const appliedVersions = new Set(appliedRows.map((row) => Number(row['version'])));

  for (const migration of SCHEMA_MIGRATIONS) {
    // Executa sempre de forma idempotente para proteger bancos preexistentes antes do versionamento
    await migration.up(drv);
    if (!appliedVersions.has(migration.version)) {
      await drv.run(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(version) DO NOTHING`,
        [migration.version, migration.name]
      );
    }
  }
}

export async function listAppliedMigrations(): Promise<SchemaMigrationRecord[]> {
  const rows = await requireDriver().all(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC',
    []
  );
  return rows.map((row) => ({
    version: Number(row['version'] ?? 0),
    name: String(row['name'] ?? ''),
    applied_at: String(row['applied_at'] ?? ''),
  }));
}

/* --------------------------------------------------------------------------
 * Estado interno
 * ------------------------------------------------------------------------ */

let driver: DbDriver | null = null;
let settingsCache = new Map<string, string | null>();
let initialized = false;

function requireDriver(): DbDriver {
  if (!driver) throw new Error('Banco de dados nao inicializado. Chame initDatabase() antes.');
  return driver;
}

/* --------------------------------------------------------------------------
 * Inicializacao
 * ------------------------------------------------------------------------ */

/**
 * Inicializa a persistencia, cria o schema, aplica migracoes versionadas e carrega o cache de configuracoes.
 */
export async function initDatabase(options: InitDatabaseOptions = {}): Promise<DbDriver> {
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
    const filePath =
      options.path ?? process.env.DATABASE_PATH ?? join(DATA_DIR, 'barbearia.db');
    driver = await createSqliteDriver(filePath);
  }

  await driver.exec(SCHEMA);
  await runSchemaMigrations(driver);
  await seedDefaults(driver);
  await loadSettings();
  initialized = true;
  return driver;
}

export const initDb = initDatabase;

async function seedDefaults(drv: DbDriver): Promise<void> {
  const statements: BatchStatement[] = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
    params: [key, String(value)],
  }));

  // Segredo usado para assinar a sessao do painel (gerado uma unica vez).
  statements.push({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
    params: ['session_secret', randomBytes(32).toString('hex')],
  });

  await drv.batch(statements);

  const total = await drv.get('SELECT COUNT(*) AS total FROM business_hours', []);
  if (Number(total?.['total'] || 0) === 0) {
    await drv.batch(
      DEFAULT_BUSINESS_HOURS.map((row) => ({
        sql: `INSERT INTO business_hours (weekday, is_open, open_time, close_time, break_start, break_end)
              VALUES (?, ?, ?, ?, NULL, NULL)`,
        params: [row.weekday, row.is_open, row.open_time, row.close_time],
      }))
    );
  }

  // Semeia planos SaaS padrao
  await drv.batch([
    {
      sql: `INSERT INTO plans (id, name, price_cents, max_barbers, max_services, whatsapp_cloud, reports_advanced)
            VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      params: ['free', 'Gratuito', 0, 2, 10, 0, 0],
    },
    {
      sql: `INSERT INTO plans (id, name, price_cents, max_barbers, max_services, whatsapp_cloud, reports_advanced)
            VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      params: ['pro', 'Profissional', 7900, 20, 100, 1, 1],
    },
  ]);

  // Semeia barbearias multi-tenant caso a tabela esteja vazia
  const totalShops = await drv.get('SELECT COUNT(*) AS total FROM barbershops', []);
  if (Number(totalShops?.['total'] || 0) === 0) {
    const defaultCuts = JSON.stringify([
      {
        title: 'Degradê Navalhado',
        desc: 'Acabamento milimétrico na navalha e contorno alinhado',
        tag: 'Cabelo',
      },
      {
        title: 'Barboterapia & Toalha Quente',
        desc: 'Aroma suave, hidratação profunda e lâmina afiada',
        tag: 'Barba',
      },
      {
        title: 'Corte Social Moderno',
        desc: 'Tesoura e acabamento executivo impecável',
        tag: 'Clássico',
      },
      {
        title: 'Platinado & Texturizado',
        desc: 'Descoloração segura e pomada matte',
        tag: 'Estilo',
      },
    ]);

    await drv.batch([
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
          'Av. Modelo, 100 - Centro, Cidade Fictícia - SP',
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
          'Rua Exemplo, 200 - Bairro Jardim, Cidade Fictícia - SP',
          '@barbeariapremium.sp',
          '#3B82F6',
          defaultCuts,
        ],
      },
    ]);
  }

  // Semeia reviews verificadas de demonstracao
  const totalReviews = await drv.get('SELECT COUNT(*) AS total FROM reviews', []);
  if (Number(totalReviews?.['total'] || 0) === 0) {
    await drv.batch([
      {
        sql: `INSERT INTO reviews (shop_slug, client_name, rating, comment, verified) VALUES (?, ?, ?, ?, 1)`,
        params: [
          'nova-barbearia',
          'Lucas Mendes',
          5,
          'Melhor atendimento de SP. Pontualidade britânica e o degradê ficou impecável!',
        ],
      },
      {
        sql: `INSERT INTO reviews (shop_slug, client_name, rating, comment, verified) VALUES (?, ?, ?, ?, 1)`,
        params: [
          'nova-barbearia',
          'Rafael Silveira',
          5,
          'A barboterapia com toalha quente relaxa demais. Ambiente de altíssimo padrão.',
        ],
      },
      {
        sql: `INSERT INTO reviews (shop_slug, client_name, rating, comment, verified) VALUES (?, ?, ?, ?, 1)`,
        params: [
          'nova-barbearia',
          'Guilherme Castro',
          5,
          'Agendamento super fácil pelo Instagram, sem precisar baixar nada. Recomendo muito!',
        ],
      },
    ]);
  }
}

/* --------------------------------------------------------------------------
 * API de consulta
 * ------------------------------------------------------------------------ */

/** Executa um SELECT e devolve todas as linhas. */
export function all<T extends DbRow = DbRow>(
  sql: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  return requireDriver().all(sql, params) as Promise<T[]>;
}

/** Executa um SELECT e devolve a primeira linha (ou null). */
export function get<T extends DbRow = DbRow>(
  sql: string,
  params: readonly unknown[] = []
): Promise<T | null> {
  return requireDriver().get(sql, params) as Promise<T | null>;
}

/** Executa um INSERT/UPDATE/DELETE e devolve { changes, lastInsertRowid }. */
export function run(sql: string, params: readonly unknown[] = []): Promise<DbRunResult> {
  return requireDriver().run(sql, params);
}

/** Executa varias instrucoes de escrita de forma atomica. */
export function batch(statements: readonly BatchStatement[] = []): Promise<DbRunResult[]> {
  return requireDriver().batch(statements);
}

/** Executa SQL livre (multiplas instrucoes). */
export function exec(sql: string): Promise<void> {
  return requireDriver().exec(sql);
}

/* --------------------------------------------------------------------------
 * Configuracoes (cache em memoria, leitura sincrona)
 * ------------------------------------------------------------------------ */

export async function loadSettings(): Promise<Map<string, string | null>> {
  const rows = await requireDriver().all('SELECT key, value FROM settings', []);
  settingsCache = new Map(
    rows.map((row) => [
      String(row['key'] ?? ''),
      row['value'] === null || row['value'] === undefined ? null : String(row['value']),
    ])
  );
  return settingsCache;
}

export function getSettingsMap(): Record<string, string | null> {
  return Object.fromEntries(settingsCache.entries());
}

export function getSetting(key: string, fallback: string): string;
export function getSetting(key: string, fallback?: string | null): string | null;
export function getSetting(key: string, fallback: string | null = null): string | null {
  const value = settingsCache.get(key);
  if (value === undefined || value === null) return fallback;
  return value;
}

export async function setSetting(
  key: string,
  value: string | number | boolean | null | undefined
): Promise<string | null> {
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

export function driverKind(): DriverKind {
  return driver ? driver.kind : 'none';
}

export function driverLabel(): string {
  return driver ? driver.label : '-';
}

export function isInitialized(): boolean {
  return initialized;
}

export async function healthCheck(): Promise<HealthCheckResult> {
  const started = Date.now();
  try {
    const active = requireDriver();
    await active.get('SELECT 1 AS ok', []);
    return {
      ok: true,
      driver: active.kind,
      target: active.label,
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      driver: driver ? driver.kind : 'none',
      target: driver ? driver.label : null,
      latency_ms: Date.now() - started,
      error: message,
    };
  }
}

export async function closeDatabase(): Promise<void> {
  if (!driver) return;
  await driver.close();
  driver = null;
  initialized = false;
}

/* --------------------------------------------------------------------------
 * Multi-barbearia & Reputacao
 * ------------------------------------------------------------------------ */

export async function getShopBySlug(slug: string = 'nova-barbearia'): Promise<DbRow | null> {
  const shop = await get('SELECT * FROM barbershops WHERE slug = ? AND active = 1', [slug]);
  if (!shop && slug === 'nova-barbearia') {
    return await get('SELECT * FROM barbershops WHERE active = 1 ORDER BY id ASC LIMIT 1', []);
  }
  return shop || null;
}

export async function listShops(): Promise<DbRow[]> {
  return await all(
    'SELECT id, slug, name, company, description, logo_url, address, instagram, whatsapp FROM barbershops WHERE active = 1 ORDER BY name ASC',
    []
  );
}

export async function getShopReviews(slug: string = 'nova-barbearia'): Promise<DbRow[]> {
  return await all(
    'SELECT id, client_name, rating, comment, verified, created_at FROM reviews WHERE shop_slug = ? ORDER BY id DESC LIMIT 20',
    [slug]
  );
}

export async function addReview({
  shopSlug = 'nova-barbearia',
  clientName,
  rating,
  comment,
  appointmentId,
  barberId,
}: AddReviewInput): Promise<DbRunResult> {
  let verified = 0;
  if (appointmentId) {
    const appt = await get(
      `SELECT a.id, a.status
         FROM appointments a
         LEFT JOIN barbershops s ON s.id = a.shop_id
        WHERE a.id = ? AND (s.slug = ? OR (a.shop_id = 1 AND ? = 'nova-barbearia'))`,
      [Number(appointmentId), shopSlug, shopSlug]
    );
    if (appt && appt['status'] !== 'cancelled') {
      verified = 1;
    }
  }
  return await run(
    'INSERT INTO reviews (shop_slug, client_name, rating, comment, appointment_id, barber_id, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      shopSlug,
      clientName,
      Number(rating),
      comment || '',
      appointmentId || null,
      barberId || null,
      verified,
    ]
  );
}

export async function getAllShopSettings(
  shopId: number = 1
): Promise<Record<string, string | null>> {
  const sid = Number(shopId) || 1;
  const base: Record<string, string | null> =
    sid === 1 ? getSettingsMap() : { ...DEFAULT_SETTINGS };
  const rows = await all('SELECT key, value FROM shop_settings WHERE shop_id = ?', [sid]);
  for (const row of rows) {
    const k = String(row['key'] ?? '');
    if (k) {
      base[k] = row['value'] === null || row['value'] === undefined ? null : String(row['value']);
    }
  }
  return base;
}

export async function getShopSetting(
  shopId: number,
  key: string,
  fallback: string = ''
): Promise<string> {
  const sid = Number(shopId) || 1;
  const row = await get('SELECT value FROM shop_settings WHERE shop_id = ? AND key = ?', [sid, key]);
  if (row && row['value'] !== undefined && row['value'] !== null) {
    return String(row['value']);
  }
  if (sid === 1) return getSetting(key, fallback);
  return DEFAULT_SETTINGS[key] ?? fallback;
}

export async function setShopSetting(
  shopId: number,
  key: string,
  value: unknown
): Promise<void> {
  const sid = Number(shopId) || 1;
  const str = String(value ?? '');
  await run(
    `INSERT INTO shop_settings (shop_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(shop_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now','localtime')`,
    [sid, key, str]
  );
  if (sid === 1) {
    await setSetting(key, str);
  }
}
