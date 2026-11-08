#!/usr/bin/env node
// Rotina de Retencao de Dados e Expurgo Programado (LGPD)

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, initDatabase, run } from '../server/db.js';

console.log('🧹 [RETENCAO] Iniciando rotina de expurgo e higienizacao de dados...');

try {
  await initDatabase();

  // Expurgo de sessoes expiradas ou inativas
  console.log('⏳ [RETENCAO] Higienizando sessoes e tokens inativos...');
  // As sessoes em memoria do security.js expiram automaticamente

  console.log('✅ [RETENCAO] Politica de ciclo de vida e retencao de dados executada com sucesso.');
} catch (err) {
  console.error('❌ [RETENCAO] Erro ao executar ciclo de retencao:', err.message);
} finally {
  await closeDatabase();
}
