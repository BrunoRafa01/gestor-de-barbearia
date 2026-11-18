#!/usr/bin/env node
// Rotina de Backup Automatico do Banco de Dados com Retencao e Integridade

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PROJECT_ROOT } from '../server/paths.js';

const DB_PATH = process.env.DATABASE_PATH || join(PROJECT_ROOT, 'data', 'barbearia.db');
const BACKUP_DIR = join(PROJECT_ROOT, 'data', 'backups');
const MAX_BACKUPS = 14;

console.log('🛡️  [BACKUP] Iniciando rotina de backup seguro...');

if (!existsSync(DB_PATH)) {
  console.log(
    `ℹ️  [BACKUP] Banco de dados principal nao encontrado em ${DB_PATH} (modo Turso em nuvem ou primeira execucao).`
  );
  process.exit(0);
}

if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(BACKUP_DIR, `barbearia-backup-${timestamp}.db`);

try {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const size = statSync(backupPath).size;
  console.log(
    `✅ [BACKUP] Snapshot gerado com sucesso: ${backupPath} (${(size / 1024).toFixed(1)} KB)`
  );

  // Pruning de backups antigos
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('barbearia-backup-') && f.endsWith('.db'))
    .map((f) => ({
      name: f,
      path: join(BACKUP_DIR, f),
      time: statSync(join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time);

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      unlinkSync(f.path);
      console.log(`🧹 [BACKUP] Backup antigo removido conforme politica de retencao: ${f.name}`);
    }
  }

  console.log(
    `🔒 [BACKUP] Total de backups ativos retidos: ${Math.min(files.length, MAX_BACKUPS)}`
  );
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('❌ [BACKUP] Falha ao criar snapshot do banco:', message);
  process.exit(1);
}
