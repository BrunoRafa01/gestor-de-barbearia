// Exportacao e restauracao de dados (backup).
//
// O plano gratuito do Render nao possui disco persistente, por isso o banco fica
// no Turso (libSQL). Este modulo permite baixar um arquivo JSON com todos os
// dados e reimporta-lo depois, tanto no mesmo banco quanto em outro.

import { invalidateAvailabilityCaches } from '../availability.js';
import {
  all,
  batch,
  driverKind,
  getSettingsMap,
  loadSettings,
  migrateClientsEncryption,
} from '../db.js';
import { HttpError } from '../http.js';
import type { BatchStatement, DbRow, RouteContext, RouteDefinition } from '../types.js';

const BACKUP_VERSION = 1;

/** Ordem de dependencia: primeiro as referenciadas por chaves estrangeiras. */
const IMPORT_ORDER: readonly string[] = [
  'business_hours',
  'closures',
  'barbers',
  'services',
  'clients',
  'barber_hours',
  'appointments',
  'settings',
];

/** Ordem inversa, usada para limpar o banco antes de uma restauracao total. */
const DELETE_ORDER: readonly string[] = [
  'appointments',
  'barber_hours',
  'clients',
  'services',
  'barbers',
  'closures',
  'business_hours',
];

const REDACTED_SETTINGS: readonly string[] = [
  'session_secret',
  'admin_password_hash',
  'admin_password_default',
  'whatsapp_access_token',
  'whatsapp_webhook_verify_token',
];

function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new HttpError(400, `Nome de tabela invalido no backup: ${name}`);
  }
  return `"${name}"`;
}

function normalizeRowForJson(row: DbRow): DbRow {
  const output: DbRow = {};
  for (const [key, value] of Object.entries(row)) {
    output[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return output;
}

const SHOP_SCOPED_TABLES = new Set<string>(['barbers', 'services', 'clients', 'appointments']);

async function exportData(shopId = 1) {
  const sid = Number(shopId) || 1;
  const tables: Record<string, DbRow[]> = {};

  for (const table of IMPORT_ORDER) {
    let rows: DbRow[];
    if (SHOP_SCOPED_TABLES.has(table)) {
      rows = await all(`SELECT * FROM ${quoteIdentifier(table)} WHERE shop_id = ?`, [sid]);
    } else if (table === 'barber_hours') {
      rows = await all(
        `SELECT bh.* FROM barber_hours bh JOIN barbers b ON b.id = bh.barber_id WHERE b.shop_id = ?`,
        [sid]
      );
    } else if (sid === 1) {
      rows = await all(`SELECT * FROM ${quoteIdentifier(table)}`, []);
    } else {
      rows = [];
    }
    tables[table] = rows.map(normalizeRowForJson);
  }

  // O segredo de sessao nunca sai do servidor: restaurado o backup, as sessoes
  // atuais continuam validas e o segredo nao vaza no arquivo.
  if (Array.isArray(tables.settings)) {
    tables.settings = tables.settings.filter(
      (row) => !REDACTED_SETTINGS.includes(String(row.key ?? ''))
    );
  }

  return {
    meta: {
      app: 'Gestor de Barbearia',
      company: 'Nova Runtime',
      version: BACKUP_VERSION,
      shop_id: sid,
      driver: driverKind(),
      generated_at: new Date().toISOString(),
      tables: Object.keys(tables),
      counts: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length])),
    },
    data: tables,
  };
}

function isObjectRow(value: unknown): value is DbRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Monta os comandos de insercao a partir das linhas do backup, forcando isolamento por shop_id. */
function insertStatements(table: string, rows: unknown, shopId = 1): BatchStatement[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const sid = Number(shopId) || 1;

  if (!SHOP_SCOPED_TABLES.has(table) && table !== 'barber_hours' && sid !== 1) {
    return [];
  }

  const validObjects = rows.filter(isObjectRow);
  const columns = [...new Set(validObjects.flatMap((row) => Object.keys(row)))].filter((key) =>
    /^[a-z_][a-z0-9_]*$/i.test(key)
  );
  if (!columns.length) return [];

  if (SHOP_SCOPED_TABLES.has(table) && !columns.includes('shop_id')) {
    columns.push('shop_id');
  }

  const target = quoteIdentifier(table);
  const columnList = columns.map((name) => quoteIdentifier(name)).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  const filteredRows =
    table === 'settings'
      ? validObjects.filter((row) => !REDACTED_SETTINGS.includes(String(row.key ?? '')))
      : validObjects;

  return filteredRows.map((row) => ({
    sql: `INSERT OR REPLACE INTO ${target} (${columnList}) VALUES (${placeholders})`,
    params: columns.map((column) => {
      if (SHOP_SCOPED_TABLES.has(table) && column === 'shop_id') return sid;
      return row[column] === undefined ? null : row[column];
    }),
  }));
}

function validateBackupInput(data: unknown): { payload: Record<string, unknown>; known: string[] } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Arquivo de backup invalido.');
  }

  const payload = data as Record<string, unknown>;
  const known = IMPORT_ORDER.filter((table) => payload[table] !== undefined);
  if (!known.length) {
    throw new HttpError(400, 'O backup nao contem nenhuma tabela reconhecida.');
  }

  for (const table of known) {
    if (!Array.isArray(payload[table])) {
      throw new HttpError(400, `A tabela "${table}" do backup deve ser uma lista.`);
    }
  }

  return { payload, known };
}

export const backupRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/backup',
    handler: async ({ shopId = 1 }: RouteContext) => ({
      status: 200,
      body: await exportData(shopId),
    }),
  },
  {
    method: 'POST',
    path: '/api/backup/import',
    bodyLimit: 8 * 1024 * 1024,
    handler: async ({ body, shopId = 1 }: RouteContext) => {
      const sid = Number(shopId) || 1;
      const backupObj =
        body?.backup && typeof body.backup === 'object' && !Array.isArray(body.backup)
          ? (body.backup as Record<string, unknown>)
          : null;
      const rawPayload = body?.data ? body.data : backupObj?.data ?? body;
      const mode = String(body?.mode || 'merge') === 'replace' ? 'replace' : 'merge';

      const { payload, known: tables } = validateBackupInput(rawPayload);

      const statements: BatchStatement[] = [];
      if (mode === 'replace') {
        for (const table of DELETE_ORDER) {
          if (SHOP_SCOPED_TABLES.has(table)) {
            statements.push({
              sql: `DELETE FROM ${quoteIdentifier(table)} WHERE shop_id = ?`,
              params: [sid],
            });
          } else if (table === 'barber_hours') {
            statements.push({
              sql: 'DELETE FROM barber_hours WHERE barber_id IN (SELECT id FROM barbers WHERE shop_id = ?)',
              params: [sid],
            });
          } else if (sid === 1) {
            if (table === 'settings') {
              const placeholders = REDACTED_SETTINGS.map(() => '?').join(', ');
              statements.push({
                sql: `DELETE FROM ${quoteIdentifier(table)} WHERE "key" NOT IN (${placeholders})`,
                params: [...REDACTED_SETTINGS],
              });
            } else {
              statements.push({ sql: `DELETE FROM ${quoteIdentifier(table)}`, params: [] });
            }
          }
        }
      }

      for (const table of IMPORT_ORDER) {
        if (!tables.includes(table)) continue;
        statements.push(...insertStatements(table, payload[table], sid));
      }

      if (!statements.length) {
        throw new HttpError(400, 'Nada para importar neste backup.');
      }

      await batch(statements);
      await migrateClientsEncryption();

      // Recarrega configuracoes e invalida caches de disponibilidade.
      await loadSettings();
      invalidateAvailabilityCaches();

      const summary = await exportData(sid);
      return {
        status: 200,
        body: {
          imported: true,
          mode,
          tables: summary.meta.tables,
          counts: summary.meta.counts,
          settings: Object.keys(getSettingsMap()).length,
        },
      };
    },
  },
];
