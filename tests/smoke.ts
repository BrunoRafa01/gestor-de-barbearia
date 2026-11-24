// Orquestrador da suite de fumaca (dividida por area em tests/smoke/).
// Uso: npm test

import { rmSync } from 'node:fs';
import {
  runCoreAuthAndHealthChecks,
  runExtendedAuthMasterAndRateLimitChecks,
} from './smoke/auth-and-security.js';
import {
  runCatalogAndBookingChecks,
  runPublicAndMultiTenantChecks,
} from './smoke/catalog-and-booking.js';
import {
  runBackupAndStabilizationChecks,
  runDashboardReportsSettingsChecks,
} from './smoke/finance-and-backup.js';
import {
  child,
  getCounts,
  serverLog,
  waitForServer,
  workDir,
} from './smoke/harness.js';

async function run(): Promise<void> {
  await waitForServer();

  await runCoreAuthAndHealthChecks();
  const ctx = await runCatalogAndBookingChecks();
  await runDashboardReportsSettingsChecks(ctx);
  await runPublicAndMultiTenantChecks(ctx);
  await runBackupAndStabilizationChecks(ctx);
  await runExtendedAuthMasterAndRateLimitChecks(ctx.targetDate, ctx.serviceId, ctx.barberId);

  const { passed, failures } = getCounts();
  const ok = failures.length === 0;
  console.log('');
  console.log(
    `  ${ok ? 'OK' : 'FALHA'}: ${passed} verificacao(oes) aprovada(s), ${failures.length} falha(s).`
  );
  if (!ok) {
    console.log('');
    for (const failure of failures) console.log(`   - ${failure}`);
    console.log('');
    console.log('  Ultimas linhas do servidor:');
    for (const line of serverLog.join('').split(/\r?\n/).slice(-20)) console.log(`   ${line}`);
  }
  console.log('');
}

run()
  .catch((error: unknown) => {
    console.error(
      'Erro inesperado no teste:',
      error instanceof Error ? error.stack || error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    const { failures } = getCounts();
    if (failures.length) process.exitCode = 1;
    child.kill('SIGTERM');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
    if (!child.killed) child.kill('SIGKILL');
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* pasta temporaria pode estar em uso no Windows */
    }
    process.exit(process.exitCode || 0);
  });
