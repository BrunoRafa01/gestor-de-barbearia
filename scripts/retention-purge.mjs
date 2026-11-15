#!/usr/bin/env node
// Rotina de Retencao de Dados e Expurgo Programado (LGPD)

import { closeDatabase, get, initDatabase, run } from '../server/db.js';
import { addDays, todayISO } from '../server/time.js';

const RETENTION_DAYS = Math.max(30, Number(process.env.LGPD_RETENTION_DAYS || 180));
const DRY_RUN = process.argv.includes('--dry-run');
const cutoffDate = addDays(todayISO(), -RETENTION_DAYS);
const tokenCutoffDate = addDays(todayISO(), -7);

console.log(`🧹 [RETENCAO] Iniciando expurgo LGPD (corte: < ${cutoffDate}, dryRun=${DRY_RUN})...`);

try {
  await initDatabase();

  const expiredTokens = await get(
    'SELECT COUNT(*) AS total FROM appointments WHERE cancel_token IS NOT NULL AND date < ?',
    [tokenCutoffDate]
  );
  const oldMessages = await get(
    'SELECT COUNT(*) AS total FROM whatsapp_messages WHERE date(created_at) < ?',
    [cutoffDate]
  );

  if (!DRY_RUN) {
    await run('UPDATE appointments SET cancel_token = NULL WHERE cancel_token IS NOT NULL AND date < ?', [
      tokenCutoffDate,
    ]);
    await run('DELETE FROM whatsapp_messages WHERE date(created_at) < ?', [cutoffDate]);
  }

  console.log(
    `✅ [RETENCAO] Tokens expirados limpos: ${Number(expiredTokens?.total || 0)} | Mensagens WhatsApp antigas removidas: ${Number(oldMessages?.total || 0)}.`
  );
} catch (err) {
  console.error('❌ [RETENCAO] Erro ao executar ciclo de retencao:', err.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
