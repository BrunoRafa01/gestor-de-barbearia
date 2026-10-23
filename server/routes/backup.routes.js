// Exportacao e restauracao de dados (backup).
//
// O plano gratuito do Render nao possui disco persistente, por isso o banco fica
// no Turso (libSQL). Este modulo permite baixar um arquivo JSON com todos os
// dados e reimporta-lo depois, tanto no mesmo banco quanto em outro.

import {
  all,
  batch,
  driverKind,
  getSettingsMap,
  loadSettings,
} from '../db.js';
import { invalidateAvailabilityCaches } from '../availability.js';
import { HttpError } from '../http.js';

const BACKUP_VERSION = 1;

/** Ordem de dependencia: primeiro as referenciadas por chaves estrangeiras. */
const IMPORT_ORDER = [
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
const DELETE_ORDER = [
  'appointments',
  'barber_hours',
  'clients',
  'services',
  'barbers',
  'closures',
  'business_hours',
];

const REDACTED_SETTINGS = ['session_secret'];

function quoteIdentifier(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new HttpError(400, `Nome de tabela invalido no backup: ${name}`);
  }
  return `"${name}"`;
}

function normalizeRowForJson(row) {
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    output[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return output;
}

async function exportData() {
  const tables = {};

  for (const table of IMPORT_ORDER) {
    const rows = await all(`SELECT * FROM ${quoteIdentifier(table)}`, []);
    tables[table] = rows.map(normalizeRowForJson);
  }

  // O segredo de sessao nunca sai do servidor: restaurado o backup, as sessoes
  // atuais continuam validas e o segredo nao vaza no arquivo.
  if (Array.isArray(tables.settings)) {
    tables.settings = tables.settings.filter((row) => !REDACTED_SETTINGS.includes(row.key));
  }

  return {
    meta: {
      app: 'Gestor de Barbearia',
      company: 'Nova Runtime',
      version: BACKUP_VERSION,
      driver: driverKind(),
      generated_at: new Date().toISOString(),
      tables: Object.keys(tables),
      counts: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length])),
    },
    data: tables,
  };
}

/** Monta os comandos de insercao a partir das linhas do backup. */
function insertStatements(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) =>
    /^[a-z_][a-z0-9_]*$/i.test(key)
  );
  if (!columns.length) return [];

  const target = quoteIdentifier(table);
  const columnList = columns.map((name) => quoteIdentifier(name)).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      sql: `INSERT OR REPLACE INTO ${target} (${columnList}) VALUES (${placeholders})`,
      params: columns.map((column) => (row[column] === undefined ? null : row[column])),
    }));
}

function validateBackupInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Arquivo de backup invalido.');
  }

  const known = IMPORT_ORDER.filter((table) => data[table] !== undefined);
  if (!known.length) {
    throw new HttpError(400, 'O backup nao contem nenhuma tabela reconhecida.');
  }

  for (const table of known) {
    if (!Array.isArray(data[table])) {
      throw new HttpError(400, `A tabela "${table}" do backup deve ser uma lista.`);
    }
  }

  return known;
}

export const backupRoutes = [
  {
    method: 'GET',
    path: '/api/backup',
    handler: async () => ({ status: 200, body: await exportData() }),
  },
  {
    method: 'POST',
    path: '/api/backup/import',
    bodyLimit: 8 * 1024 * 1024,
    handler: async ({ body }) => {
      const payload = body?.data ? body.data : body?.backup?.data || body;
      const mode = String(body?.mode || 'merge') === 'replace' ? 'replace' : 'merge';

      const tables = validateBackupInput(payload);

      const statements = [];
      if (mode === 'replace') {
        for (const table of DELETE_ORDER) {
          statements.push({ sql: `DELETE FROM ${quoteIdentifier(table)}`, params: [] });
        }
      }

      for (const table of IMPORT_ORDER) {
        if (!tables.includes(table)) continue;
        statements.push(...insertStatements(table, payload[table]));
      }

      if (!statements.length) {
        throw new HttpError(400, 'Nada para importar neste backup.');
      }

      await batch(statements);

      // Recarrega configuracoes e invalida caches de disponibilidade.
      await loadSettings();
      invalidateAvailabilityCaches();

      const summary = await exportData();
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
