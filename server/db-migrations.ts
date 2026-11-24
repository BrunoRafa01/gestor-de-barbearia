// Schema SQLite/Turso e migracoes versionadas do Gestor de Barbearia.

import {
  blindIndex,
  decryptSensitiveField,
  encryptSensitiveField,
  isEncryptedField,
} from './security.js';
import type { BatchStatement, DbRow, DbRunResult, SchemaMigrationRecord } from './types.js';

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

interface SchemaMigration {
  version: number;
  name: string;
  up: (drv: DbDriver) => Promise<void>;
}

export const SCHEMA = `
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
  phone_hash TEXT,
  email      TEXT,
  birth_date TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_clients_shop_phone ON clients(shop_id, phone);
CREATE INDEX IF NOT EXISTS idx_clients_shop_phone_hash ON clients(shop_id, phone_hash);

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
  timezone      TEXT NOT NULL DEFAULT 'America/Fortaleza',
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
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id             INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'owner',
  active              INTEGER NOT NULL DEFAULT 1,
  session_version     INTEGER NOT NULL DEFAULT 1,
  totp_secret         TEXT,
  totp_pending_secret TEXT,
  totp_enabled        INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_users_shop ON users(shop_id);

CREATE TABLE IF NOT EXISTS security_logs (
  id            TEXT PRIMARY KEY,
  timestamp     TEXT NOT NULL,
  type          TEXT NOT NULL,
  ip_anonymized TEXT NOT NULL,
  user_agent    TEXT NOT NULL,
  details_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at);

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

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
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
  {
    version: 5,
    name: '005_clients_encryption_and_phone_hash',
    async up(drv) {
      await ensureColumn(drv, 'clients', 'phone_hash', 'TEXT');
      await drv.exec(`
        CREATE INDEX IF NOT EXISTS idx_clients_shop_phone_hash ON clients(shop_id, phone_hash);
        CREATE INDEX IF NOT EXISTS idx_clients_phone_hash ON clients(phone_hash);
      `);
      await migrateClientsEncryption(drv);
    },
  },
  {
    version: 6,
    name: '006_security_hardening_etapa2',
    async up(drv) {
      await ensureColumn(drv, 'users', 'session_version', 'INTEGER NOT NULL DEFAULT 1');
      await ensureColumn(drv, 'users', 'totp_secret', 'TEXT');
      await ensureColumn(drv, 'users', 'totp_pending_secret', 'TEXT');
      await ensureColumn(drv, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
      await drv.exec(`
        CREATE TABLE IF NOT EXISTS security_logs (
          id            TEXT PRIMARY KEY,
          timestamp     TEXT NOT NULL,
          type          TEXT NOT NULL,
          ip_anonymized TEXT NOT NULL,
          user_agent    TEXT NOT NULL,
          details_json  TEXT NOT NULL,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at);
      `);
    },
  },
  {
    version: 7,
    name: '007_shop_timezone',
    async up(drv) {
      await ensureColumn(drv, 'barbershops', 'timezone', "TEXT NOT NULL DEFAULT 'America/Fortaleza'");
    },
  },
];

/**
 * Criptografa dados pessoais (nome, telefone, e-mail) de clientes ainda em texto claro
 * e preenche o indice cego phone_hash de forma idempotente e sem perda de dados.
 */
export async function migrateClientsEncryption(
  targetDrv?: DbDriver,
  options: { reencrypt?: boolean } = {}
): Promise<{ updated: number; total: number }> {
  if (!targetDrv) throw new Error('Driver obrigatorio.');
  const drv = targetDrv;
  const rows = await drv.all('SELECT id, name, phone, email, phone_hash FROM clients', []);
  let updated = 0;

  for (const row of rows) {
    const id = Number(row['id']);
    const rawName = String(row['name'] ?? '');
    const rawPhone = String(row['phone'] ?? '');
    const rawEmail = row['email'] === null || row['email'] === undefined ? null : String(row['email']);
    const existingHash = row['phone_hash'] ? String(row['phone_hash']) : '';

    const plainName = decryptSensitiveField(rawName);
    const plainPhone = decryptSensitiveField(rawPhone);
    const plainEmail = rawEmail ? decryptSensitiveField(rawEmail) : null;

    // Se algum campo estava cifrado com chave desconhecida, nao corrompe nem recalcula hash errado
    const phoneReadable = !isEncryptedField(plainPhone);
    const nextHash = phoneReadable ? blindIndex(plainPhone) : existingHash;

    const needsNameEncrypt = !isEncryptedField(rawName) || (options.reencrypt && !isEncryptedField(plainName));
    const needsPhoneEncrypt = !isEncryptedField(rawPhone) || (options.reencrypt && phoneReadable);
    const needsEmailEncrypt =
      Boolean(rawEmail && rawEmail.length > 0) &&
      (!isEncryptedField(rawEmail) || (options.reencrypt && plainEmail !== null && !isEncryptedField(plainEmail)));
    const needsHashUpdate = Boolean(nextHash) && nextHash !== existingHash;

    if (!needsNameEncrypt && !needsPhoneEncrypt && !needsEmailEncrypt && !needsHashUpdate) {
      continue;
    }

    const finalName = needsNameEncrypt ? encryptSensitiveField(plainName) : rawName;
    const finalPhone = needsPhoneEncrypt ? encryptSensitiveField(plainPhone) : rawPhone;
    const finalEmail =
      rawEmail === null || rawEmail === ''
        ? rawEmail
        : needsEmailEncrypt && plainEmail !== null
          ? encryptSensitiveField(plainEmail)
          : rawEmail;

    await drv.run('UPDATE clients SET name = ?, phone = ?, email = ?, phone_hash = ? WHERE id = ?', [
      finalName,
      finalPhone,
      finalEmail,
      nextHash || null,
      id,
    ]);
    updated += 1;
  }

  return { updated, total: rows.length };
}

export async function runSchemaMigrations(drv: DbDriver): Promise<void> {
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


export async function listAppliedMigrationsWithDriver(drv: DbDriver): Promise<SchemaMigrationRecord[]> {
  const rows = await drv.all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC', []);
  return rows.map((row) => ({
    version: Number(row['version'] ?? 0),
    name: String(row['name'] ?? ''),
    applied_at: String(row['applied_at'] ?? ''),
  }));
}
