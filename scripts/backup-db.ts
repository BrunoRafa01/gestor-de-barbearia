#!/usr/bin/env node
// Rotina de Backup Automatico do Banco de Dados com Retencao configuravel e Integridade

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from '../server/paths.js';

export interface BackupOptions {
  dbPath?: string;
  backupDir?: string;
  maxBackups?: number;
  maxAgeDays?: number;
  silent?: boolean;
}

export interface BackupResult {
  skipped: boolean;
  backupPath?: string;
  sizeBytes?: number;
  removedCount: number;
  retainedCount: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

export function runBackup(options: BackupOptions = {}): BackupResult {
  const dbPath = options.dbPath ?? process.env.DATABASE_PATH ?? join(PROJECT_ROOT, 'data', 'barbearia.db');
  const backupDir = options.backupDir ?? process.env.BACKUP_DIR ?? join(PROJECT_ROOT, 'data', 'backups');
  const maxBackups = options.maxBackups ?? parsePositiveInt(process.env.BACKUP_RETENTION_COUNT, 14);
  const maxAgeDays = options.maxAgeDays ?? parsePositiveInt(process.env.BACKUP_RETENTION_DAYS, 30);
  const log = options.silent ? () => {} : console.log;

  log('🛡️  [BACKUP] Iniciando rotina de backup seguro...');

  if (!existsSync(dbPath)) {
    log(
      `ℹ️  [BACKUP] Banco de dados principal nao encontrado em ${dbPath} (modo Turso em nuvem ou primeira execucao).`
    );
    return { skipped: true, removedCount: 0, retainedCount: 0 };
  }

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `barbearia-backup-${timestamp}.db`);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const verifyDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const check = verifyDb.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (check?.integrity_check !== 'ok') {
      unlinkSync(backupPath);
      throw new Error(`Snapshot falhou na verificacao de integridade: ${String(check?.integrity_check)}`);
    }
  } finally {
    verifyDb.close();
  }

  const sizeBytes = statSync(backupPath).size;
  log(`✅ [BACKUP] Snapshot gerado com sucesso: ${backupPath} (${(sizeBytes / 1024).toFixed(1)} KB)`);

  const nowMs = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const files = readdirSync(backupDir)
    .filter((f) => f.startsWith('barbearia-backup-') && f.endsWith('.db'))
    .map((f) => {
      const fullPath = join(backupDir, f);
      return { name: f, path: fullPath, time: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.time - a.time);

  let removedCount = 0;
  const kept: typeof files = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!;
    const overCount = i >= maxBackups;
    const overAge = i > 0 && nowMs - file.time > maxAgeMs;
    if (overCount || overAge) {
      unlinkSync(file.path);
      removedCount += 1;
      log(`🧹 [BACKUP] Backup antigo removido conforme politica de retencao: ${file.name}`);
    } else {
      kept.push(file);
    }
  }

  log(`🔒 [BACKUP] Total de backups ativos retidos: ${kept.length}`);
  return {
    skipped: false,
    backupPath,
    sizeBytes,
    removedCount,
    retainedCount: kept.length,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    runBackup();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ [BACKUP] Falha ao criar snapshot do banco:', message);
    process.exit(1);
  }
}
