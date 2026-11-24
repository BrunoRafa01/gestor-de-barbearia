// Testes automatizados da Etapa 1:
// - Criptografia AES-256-GCM de PII de clientes (nome, telefone, e-mail)
// - Indice cego HMAC (phone_hash) e busca/duplicidade
// - Migracao idempotente e rotacao de chave (DATA_ENCRYPTION_PREVIOUS_KEY)
// - Backup automatico com retencao configuravel e script de restauracao
// - Alinhamento de textos legais e variaveis de ambiente

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tempDir = mkdtempSync(join(tmpdir(), 'gb-etapa1-'));
const dbPath = join(tempDir, 'barbearia.db');
const backupDir = join(tempDir, 'backups');

process.env.DATABASE_PATH = dbPath;
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
delete process.env.DATA_ENCRYPTION_PREVIOUS_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const { runBackup } = await import('../scripts/backup-db.js');
const { runRestore } = await import('../scripts/restore-db.js');
const { PROJECT_ROOT } = await import('../server/paths.js');
const {
  blindIndex,
  decryptSensitiveField,
  encryptSensitiveField,
  isEncryptedField,
} = await import('../server/security.js');
const { closeDatabase, get, initDatabase, migrateClientsEncryption, run } = await import('../server/db.js');
const { upsertClientByPhone } = await import('../server/appointments.js');
const { clientRoutes } = await import('../server/routes/clients.routes.js');

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${label}`);
  }
}

console.log('\n--- Testes Etapa 1: Criptografia PII, Migracao, Backup/Restore e Textos ---');

try {
  // 1. Primitivas AES-256-GCM e blindIndex
  const secret = 'Carlos Eduardo';
  const enc1 = encryptSensitiveField(secret);
  const enc2 = encryptSensitiveField(secret);
  check('encryptSensitiveField gera prefixo enc:', isEncryptedField(enc1));
  check('IV aleatorio gera ciphertexts distintos', enc1 !== enc2);
  check('decryptSensitiveField recupera texto original', decryptSensitiveField(enc1) === secret);
  check(
    'blindIndex normaliza telefone formatado e puro igualmente',
    blindIndex('(11) 99999-1234') === blindIndex('11999991234') && blindIndex('11999991234').length === 64
  );

  // 2. Inicializa banco e testa migracao de registros legados em texto claro
  await initDatabase({ path: dbPath });
  await run(
    'INSERT INTO clients (shop_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
    [1, 'Cliente Legado', '11988887777', 'legado@teste.com', 'Sem criptografia ainda']
  );

  const migResult = await migrateClientsEncryption();
  check('migrateClientsEncryption atualiza cliente legado', migResult.updated >= 1);

  const rawLegacy = await get('SELECT name, phone, email, phone_hash FROM clients WHERE phone_hash = ?', [
    blindIndex('11988887777'),
  ]);
  check('nome legado foi cifrado no banco', isEncryptedField(rawLegacy?.['name']));
  check('telefone legado foi cifrado no banco', isEncryptedField(rawLegacy?.['phone']));
  check('email legado foi cifrado no banco', isEncryptedField(rawLegacy?.['email']));
  check('phone_hash preenchido corretamente', rawLegacy?.['phone_hash'] === blindIndex('11988887777'));
  check('decrypt recupera nome legado sem perda', decryptSensitiveField(String(rawLegacy?.['name'])) === 'Cliente Legado');

  const migIdempotent = await migrateClientsEncryption();
  check('segunda execucao da migracao e idempotente (0 alterados)', migIdempotent.updated === 0);

  // 3. Upsert e rotas de clientes com busca e deteccao de duplicidade
  const upserted = await upsertClientByPhone({
    name: 'Mariana Silva',
    phone: '(11) 97777-6666',
    email: 'mariana@teste.com',
    shopId: 1,
  });
  check('upsertClientByPhone retorna dados descriptografados', upserted.name === 'Mariana Silva' && upserted.phone === '11977776666');

  const rawMariana = await get('SELECT name, phone, email, phone_hash FROM clients WHERE id = ?', [upserted.id]);
  check('registro salvo no SQLite esta cifrado', isEncryptedField(rawMariana?.['name']) && isEncryptedField(rawMariana?.['phone']));

  const listRoute = clientRoutes.find((r) => r.method === 'GET' && r.path === '/api/clients')!;
  const baseCtx = {
    req: {} as never,
    res: {} as never,
    url: new URL('http://localhost/api/clients'),
    params: {},
    body: {},
    session: null,
    isMaster: false,
    shopId: 1,
  };
  const searchByName = await listRoute.handler({
    ...baseCtx,
    query: { search: 'Mariana' },
  });
  check(
    'busca por nome em /api/clients encontra cliente cifrado',
    Array.isArray(searchByName?.body) && searchByName.body.length === 1
  );

  const searchByPhone = await listRoute.handler({
    ...baseCtx,
    query: { search: '97777' },
  });
  check(
    'busca por trecho de telefone em /api/clients encontra cliente cifrado',
    Array.isArray(searchByPhone?.body) && searchByPhone.body.length === 1
  );

  const createRoute = clientRoutes.find((r) => r.method === 'POST' && r.path === '/api/clients')!;
  let dupBlocked = false;
  try {
    await createRoute.handler({
      ...baseCtx,
      query: {},
      body: { name: 'Outro Nome', phone: '11977776666' },
    });
  } catch {
    dupBlocked = true;
  }
  check('cadastro duplicado bloqueado via blindIndex phone_hash', dupBlocked);

  // 4. Rotacao de chave com DATA_ENCRYPTION_PREVIOUS_KEY
  const oldKey = process.env.DATA_ENCRYPTION_KEY!;
  const newKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  process.env.DATA_ENCRYPTION_PREVIOUS_KEY = oldKey;
  process.env.DATA_ENCRYPTION_KEY = newKey;

  check(
    'decryptSensitiveField le dado da chave anterior durante rotacao',
    decryptSensitiveField(String(rawMariana?.['name'])) === 'Mariana Silva'
  );
  const rotated = await migrateClientsEncryption(undefined, { reencrypt: true });
  check('reencrypt rotaciona todos os registros para chave nova', rotated.updated >= 2);
  delete process.env.DATA_ENCRYPTION_PREVIOUS_KEY;
  const rawAfterRotate = await get('SELECT name, phone_hash FROM clients WHERE id = ?', [upserted.id]);
  check(
    'apos remover chave antiga, nova chave descriptografa normalmente',
    decryptSensitiveField(String(rawAfterRotate?.['name'])) === 'Mariana Silva' &&
      rawAfterRotate?.['phone_hash'] === blindIndex('11977776666')
  );

  // 5. Backup com retencao e Restore testado
  await closeDatabase();
  const b1 = runBackup({ dbPath, backupDir, maxBackups: 2, silent: true });
  await new Promise((r) => setTimeout(r, 15));
  const b2 = runBackup({ dbPath, backupDir, maxBackups: 2, silent: true });
  await new Promise((r) => setTimeout(r, 15));
  const b3 = runBackup({ dbPath, backupDir, maxBackups: 2, silent: true });
  check('backup cria snapshot integro', !b1.skipped && !b2.skipped && !b3.skipped);
  check('politica de retencao limita backups retidos a maxBackups=2', b3.retainedCount === 2 && b3.removedCount >= 1);

  // Apaga o banco principal e restaura do ultimo snapshot
  unlinkSync(dbPath);
  const restoreRes = runRestore({ dbPath, backupDir, silent: true });
  check('restore recupera o banco a partir do ultimo snapshot', restoreRes.restoredFrom === b3.backupPath);

  const checkDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const integrity = checkDb.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
    const countRow = checkDb.prepare('SELECT COUNT(*) AS total FROM clients').get() as { total: number };
    check('banco restaurado passa no PRAGMA integrity_check', integrity.integrity_check === 'ok');
    check('banco restaurado preserva todos os clientes', Number(countRow.total) >= 2);
  } finally {
    checkDb.close();
  }

  // 6. Alinhamento de textos legais, docs e env
  const termos = readFileSync(join(PROJECT_ROOT, 'public', 'termos.html'), 'utf8');
  const privacidade = readFileSync(join(PROJECT_ROOT, 'public', 'privacidade.html'), 'utf8');
  const plano = readFileSync(join(PROJECT_ROOT, 'docs', 'COMPLIANCE-40-REQUISITOS-PLANO.md'), 'utf8');
  const envExample = readFileSync(join(PROJECT_ROOT, '.env.example'), 'utf8');
  const renderYaml = readFileSync(join(PROJECT_ROOT, 'render.yaml'), 'utf8');
  const deployMd = readFileSync(join(PROJECT_ROOT, 'DEPLOY.md'), 'utf8');

  check('termos.html nao promete SLA 99.5% nem backup diario inexistente', !termos.includes('99.5%') && !termos.includes('backup diário'));
  check('privacidade.html nao afirma criptografia de ponta a ponta do Turso', !privacidade.includes('criptografia de ponta a ponta'));
  check('COMPLIANCE-40-REQUISITOS-PLANO.md cita scrypt em vez de bcrypt', !plano.includes('bcrypt') && plano.includes('scrypt'));
  check('.env.example e render.yaml documentam DATA_ENCRYPTION_KEY', envExample.includes('DATA_ENCRYPTION_KEY') && renderYaml.includes('DATA_ENCRYPTION_KEY'));
  check('DEPLOY.md documenta guarda e rotacao da DATA_ENCRYPTION_KEY', deployMd.includes('DATA_ENCRYPTION_KEY') && deployMd.includes('DATA_ENCRYPTION_PREVIOUS_KEY'));

  assert.equal(failed, 0, `${failed} verificacao(oes) falharam na Etapa 1.`);
  console.log(`\n  OK: ${passed} verificacao(oes) da Etapa 1 aprovada(s), 0 falha(s).\n`);
} finally {
  await closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
}
