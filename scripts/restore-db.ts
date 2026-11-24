#!/usr/bin/env node
// Rotina de Restauracao Segura do Banco de Dados SQLite com Verificacao de Integridade

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from '../server/paths.js';

export interface RestoreOptions {
  backupFile?: string;
  dbPath?: string;
  backupDir?: string;
  silent?: boolean;
}

export interface RestoreResult {
  restoredFrom: string;
  dbPath: string;
  safetyBackupPath?: string;
}

function findLatestBackup(backupDir: string): string {
  if (!existsSync(backupDir)) {
    throw new Error(`Diretorio de backups nao encontrado: ${backupDir}`);
  }
  const files = readdirSync(backupDir)
    .filter((f) => f.startsWith('barbearia-backup-') && f.endsWith('.db'))
    .map((f) => {
      const fullPath = join(backupDir, f);
      return { path: fullPath, time: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.time - a.time);

  const latest = files[0];
  if (!latest) {
    throw new Error(`Nenhum arquivo de backup encontrado em ${backupDir}`);
  }
  return latest.path;
}

export function runRestore(options: RestoreOptions = {}): RestoreResult {
  const dbPath = options.dbPath ?? process.env.DATABASE_PATH ?? join(PROJECT_ROOT, 'data', 'barbearia.db');
  const backupDir = options.backupDir ?? process.env.BACKUP_DIR ?? join(PROJECT_ROOT, 'data', 'backups');
  const backupFile = options.backupFile ?? findLatestBackup(backupDir);
  const log = options.silent ? () => {} : console.log;

  if (!existsSync(backupFile)) {
    throw new Error(`Arquivo de backup nao encontrado: ${backupFile}`);
  }

  // Valida integridade do backup antes de sobrescrever o banco atual
  const checkDb = new DatabaseSync(backupFile, { readOnly: true });
  try {
    const check = checkDb.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (check?.integrity_check !== 'ok') {
      throw new Error(`Backup corrompido (integrity_check=${String(check?.integrity_check)})`);
    }
  } finally {
    checkDb.close();
  }

  mkdirSync(dirname(dbPath), { recursive: true });

  let safetyBackupPath: string | undefined;
  if (existsSync(dbPath)) {
    mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    safetyBackupPath = join(backupDir, `pre-restore-${ts}.db`);
    copyFileSync(dbPath, safetyBackupPath);
    log(`🛟 [RESTORE] Copia de seguranca do banco atual salva em ${safetyBackupPath}`);
  }

  const tempTarget = `${dbPath}.restoring-${Date.now()}`;
  copyFileSync(backupFile, tempTarget);
  renameSync(tempTarget, dbPath);

  log(`✅ [RESTORE] Banco restaurado com sucesso a partir de ${backupFile}`);
  return {
    restoredFrom: backupFile,
    dbPath,
    safetyBackupPath,
  };
}

function readArgFile(): string | undefined {
  const idx = process.argv.indexOf('--file');
  if (idx !== -1 && process.argv[idx + 1]) {
    return resolve(process.argv[idx + 1]!);
  }
  return undefined;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    runRestore({ backupFile: readArgFile() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ [RESTORE] Falha ao restaurar banco:', message);
    process.exit(1);
  }
}
