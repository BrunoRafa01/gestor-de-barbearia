#!/usr/bin/env node
// Auditoria tecnica dos controles implementados, autodeclarados e pendentes.

import { runComplianceAudit } from '../server/compliance.js';

const audit = runComplianceAudit();

console.log('\n================================================================');
console.log('AUDITORIA TECNICA DE CONTROLES (LGPD, CDC e Seguranca)');
console.log('================================================================\n');

for (const item of audit.requisitos) {
  console.log(`[${item.status.padEnd(13)}] #${String(item.id).padStart(2, '0')} ${item.name} — ${item.evidence}`);
}

console.log('\n----------------------------------------------------------------');
console.log(
  `Resumo: ${audit.implementados} implementados | ${audit.autodeclarados} autodeclarados | ${audit.pendentes} pendentes (controles tecnicos: ${audit.controles_tecnicos_percentual})`
);
console.log('----------------------------------------------------------------\n');
