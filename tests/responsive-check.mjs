// Teste de responsividade e integridade multi-dispositivo do Gestor de Barbearia.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = join(ROOT, 'public', 'css', 'app.css');
const htmlAgendarPath = join(ROOT, 'public', 'agendar.html');
const htmlIndexPath = join(ROOT, 'public', 'index.html');

let passed = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  [OK] ${name}`);
  } else {
    failures.push(extra ? `${name} (${extra})` : name);
    console.error(`  [FALHA] ${name}: ${extra}`);
  }
}

console.log('\n--- Verificando Responsividade e Suporte Mobile/Desktop ---\n');

// 1. Meta Viewports
const htmlAgendar = readFileSync(htmlAgendarPath, 'utf8');
const htmlIndex = readFileSync(htmlIndexPath, 'utf8');

check('agendar.html possui meta viewport com viewport-fit=cover (iOS notch)',
  htmlAgendar.includes('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'));

check('index.html possui meta viewport com viewport-fit=cover',
  htmlIndex.includes('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'));

// 2. CSS Rules
const css = readFileSync(cssPath, 'utf8');

check('Suporte a safe-area-inset no topo e base para iPhones com notch/Dynamic Island',
  css.includes('env(safe-area-inset-top') && css.includes('env(safe-area-inset-bottom'));

check('Desativacao do atraso de toque de 300ms com touch-action: manipulation',
  css.includes('touch-action: manipulation'));

check('Prevencao de zoom indesejado no iOS Safari (inputs com font-size: 16px no mobile)',
  css.includes('font-size: 16px !important'));

check('Alvo de toque com altura minima recomendada (>= 44px) para botoes em telas pequenas',
  css.includes('min-height: 44px'));

check('Toggle da sidebar do painel acessivel com area minima de toque (44x44px)',
  css.includes('min-width: 44px') && css.includes('min-height: 44px'));

check('Rolagem horizontal suave em tabelas com -webkit-overflow-scrolling: touch',
  css.includes('-webkit-overflow-scrolling: touch'));

check('Faixa de dias da pagina publica adaptada para telas ultra-compactas (320px - 360px)',
  css.includes('.day-strip') && css.includes('scrollbar-width: none'));

check('Breakpoints responsivos presentes para Desktop (1080px), Tablet (860px) e Smartphone (560px)',
  css.includes('@media (max-width: 1080px)') &&
  css.includes('@media (max-width: 860px)') &&
  css.includes('@media (max-width: 560px)'));

console.log(`\nResultado: ${passed} verificacoes aprovadas, ${failures.length} falhas.\n`);
if (failures.length > 0) process.exit(1);
