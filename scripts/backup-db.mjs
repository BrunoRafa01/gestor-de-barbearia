#!/usr/bin/env node
// Rotina de Backup Automatico do Banco de Dados com Retencao e Integridade

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const DB_PATH = process.env.DATABASE_PATH || join(ROOT_DIR, 'data', 'barbearia.db');
const BACKUP_DIR = join(ROOT_DIR, 'data', 'backups');
const MAX_BACKUPS = 14;

console.log('🛡️  [BACKUP] Iniciando rotina de backup seguro...');

if (!existsSync(DB_PATH)) {
  console.log(`ℹ️  [BACKUP] Banco de dados principal nao encontrado em ${DB_PATH} (modo Turso em nuvem ou primeira execucao).`);
  process.exit(0);
}

if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(BACKUP_DIR, `barbearia-backup-${timestamp}.db`);

try {
  copyFileSync(DB_PATH, backupPath);
  const size = statSync(backupPath).size;
  console.log(`✅ [BACKUP] Snapshot gerado com sucesso: ${backupPath} (${(size / 1024).toFixed(1)} KB)`);

  // Pruning de backups antigos
  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('barbearia-backup-') && f.endsWith('.db'))
    .map(f => ({ name: f, path: join(BACKUP_DIR, f), time: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      unlinkSync(f.path);
      console.log(`🧹 [BACKUP] Backup antigo removido conforme politica de retencao: ${f.name}`);
    }
  }

  console.log(`🔒 [BACKUP] Total de backups ativos retidos: ${Math.min(files.length, MAX_BACKUPS)}`);
} catch (err) {
  console.error('❌ [BACKUP] Falha ao criar snapshot do banco:', err.message);
  process.exit(1);
}
