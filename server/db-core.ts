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
import {
  type DbDriver,
  type DriverKind,
  SCHEMA,
  listAppliedMigrationsWithDriver,
  migrateClientsEncryption as migrateClientsWithDriver,
  runSchemaMigrations,
} from './db-migrations.js';
import { DATA_DIR } from './paths.js';
import { registerSecurityLogStore, type SecurityLogEntry } from './security.js';
export type { DbDriver, DriverKind } from './db-migrations.js';
import type {
  BatchStatement,
  DbRow,
  DbRunResult,
  SchemaMigrationRecord,
  SqlParam,
} from './types.js';



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
  timezone: process.env.TZ || 'America/Fortaleza',
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

export async function listAppliedMigrations(): Promise<SchemaMigrationRecord[]> {
  return listAppliedMigrationsWithDriver(requireDriver());
}

export async function migrateClientsEncryption(targetDrv?: DbDriver, options: { reencrypt?: boolean } = {}) {
  return migrateClientsWithDriver(targetDrv ?? requireDriver(), options);
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
  const activeDriver = driver;
  registerSecurityLogStore({
    async insert(entry: SecurityLogEntry) {
      await activeDriver.run(
        `INSERT INTO security_logs (id, timestamp, type, ip_anonymized, user_agent, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          entry.id,
          entry.timestamp,
          entry.type,
          entry.ip_anonymized,
          entry.userAgent,
          JSON.stringify(entry.details ?? {}),
        ]
      );
    },
    async list(limit: number) {
      const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
      const rows = await activeDriver.all(
        `SELECT id, timestamp, type, ip_anonymized, user_agent, details_json
           FROM security_logs
          ORDER BY timestamp DESC, rowid DESC
          LIMIT ?`,
        [safeLimit]
      );
      return rows.map((r) => {
        let details: Record<string, unknown>;
        try {
          details = JSON.parse(String(r['details_json'] || '{}')) as Record<string, unknown>;
        } catch {
          details = {};
        }
        return {
          id: String(r['id'] ?? ''),
          timestamp: String(r['timestamp'] ?? ''),
          type: String(r['type'] ?? ''),
          ip_anonymized: String(r['ip_anonymized'] ?? '0.0.0.0'),
          userAgent: String(r['user_agent'] ?? 'n/a'),
          details,
        };
      });
    },
  });
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
  registerSecurityLogStore(null);
  if (!driver) return;
  await driver.close();
  driver = null;
  initialized = false;
}

/* --------------------------------------------------------------------------
 * Multi-barbearia & Reputacao
 * ------------------------------------------------------------------------ */
