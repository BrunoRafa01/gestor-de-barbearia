#!/usr/bin/env node
// Rotina de Retencao de Dados e Expurgo Programado (LGPD)

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, get, initDatabase, run } from '../server/db.js';
import { PROJECT_ROOT } from '../server/paths.js';
import { addDays, todayISO } from '../server/time.js';

export interface RetentionPurgeOptions {
  retentionDays?: number;
  dryRun?: boolean;
  dbPath?: string;
  silent?: boolean;
}

export interface RetentionPurgeResult {
  cutoffDate: string;
  expiredTokensCleared: number;
  oldMessagesDeleted: number;
  oldSecurityLogsDeleted: number;
}

export async function runRetentionPurge(
  options: RetentionPurgeOptions = {}
): Promise<RetentionPurgeResult> {
  const retentionDays = Math.max(
    30,
    Number(options.retentionDays ?? process.env.LGPD_RETENTION_DAYS ?? 180)
  );
  const dryRun = Boolean(options.dryRun);
  const cutoffDate = addDays(todayISO(), -retentionDays);
  const tokenCutoffDate = addDays(todayISO(), -7);
  const log = options.silent ? () => {} : console.log;

  log(`🧹 [RETENCAO] Iniciando expurgo LGPD (corte: < ${cutoffDate}, dryRun=${dryRun})...`);

  const defaultDbPath = options.dbPath ?? process.env.DATABASE_PATH ?? join(PROJECT_ROOT, 'data', 'barbearia.db');
  await initDatabase(process.env.TURSO_DATABASE_URL && !options.dbPath ? {} : { path: defaultDbPath });

  const expiredTokens = await get(
    'SELECT COUNT(*) AS total FROM appointments WHERE cancel_token IS NOT NULL AND date < ?',
    [tokenCutoffDate]
  );
  const oldMessages = await get(
    'SELECT COUNT(*) AS total FROM whatsapp_messages WHERE date(created_at) < ?',
    [cutoffDate]
  );
  const oldSecurityLogs = await get(
    'SELECT COUNT(*) AS total FROM security_logs WHERE date(created_at) < ?',
    [cutoffDate]
  );

  if (!dryRun) {
    await run(
      'UPDATE appointments SET cancel_token = NULL WHERE cancel_token IS NOT NULL AND date < ?',
      [tokenCutoffDate]
    );
    await run('DELETE FROM whatsapp_messages WHERE date(created_at) < ?', [cutoffDate]);
    await run('DELETE FROM security_logs WHERE date(created_at) < ?', [cutoffDate]);
  }

  const result: RetentionPurgeResult = {
    cutoffDate,
    expiredTokensCleared: Number(expiredTokens?.total || 0),
    oldMessagesDeleted: Number(oldMessages?.total || 0),
    oldSecurityLogsDeleted: Number(oldSecurityLogs?.total || 0),
  };

  log(
    `✅ [RETENCAO] Tokens expirados limpos: ${result.expiredTokensCleared} | Mensagens WhatsApp removidas: ${result.oldMessagesDeleted} | Logs de seguranca removidos: ${result.oldSecurityLogsDeleted}.`
  );
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runRetentionPurge({ dryRun: process.argv.includes('--dry-run') })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('❌ [RETENCAO] Erro ao executar ciclo de retencao:', message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabase();
    });
}
