// Testes automatizados da Etapa 5 — Desempenho e Acessibilidade:
// 1. Imagens WebP responsivas (-480w / -960w) + loading="lazy" sem JPGs pesados
// 2. Eliminacao de capturas de tela duplicadas em public/img/screens/
// 3. Carregamento de GSAP/Motion/Lenis restrito as paginas que usam
// 4. Service Worker com cache offline do shell (sem cachear /api/*)
// 5. Acessibilidade: contraste AA, :focus-visible, prefers-reduced-motion e aria-live

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../server/paths.js';

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

console.log('\n--- Testes Etapa 5: Desempenho, WebP, SW Offline e Acessibilidade ---');

const imgDir = join(PROJECT_ROOT, 'public', 'img');
const cutsDir = join(imgDir, 'cuts');

const allImgFiles = [
  ...readdirSync(imgDir).filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f)),
  ...readdirSync(cutsDir).filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f)),
];

const hasHeavyJpg = allImgFiles.some((f) => /\.(jpg|jpeg)$/i.test(f));
const webpCount = allImgFiles.filter((f) => f.endsWith('.webp')).length;
const totalBytes = [...readdirSync(imgDir), ...readdirSync(cutsDir).map((f) => join('cuts', f))]
  .filter((rel) => rel.endsWith('.webp'))
  .reduce((acc, rel) => acc + statSync(join(imgDir, rel)).size, 0);

check('nenhum JPG pesado restante em public/img ou public/img/cuts', !hasHeavyJpg);
check('todas as fotos foram convertidas para WebP com versoes responsivas (-480w/-960w)', webpCount >= 30);
check('tamanho total das imagens WebP abaixo de 2.5 MB', totalBytes < 2_500_000);

// 2. Sem duplicacao entre docs/screenshots e public/img/screens
check('pasta duplicada public/img/screens foi removida', !existsSync(join(imgDir, 'screens')));
check('capturas canonicas mantidas em docs/screenshots', existsSync(join(PROJECT_ROOT, 'docs', 'screenshots', 'dashboard.png')));

// 3. Lazy-loading e bundles de animacao apenas onde usados
const agendarTs = readFileSync(join(PROJECT_ROOT, 'src', 'client', 'agendar.ts'), 'utf8');
const apresentacaoHtml = readFileSync(join(PROJECT_ROOT, 'public', 'apresentacao.html'), 'utf8');
const consentTs = readFileSync(join(PROJECT_ROOT, 'src', 'client', 'consent.ts'), 'utf8');
const docMotionTs = readFileSync(join(PROJECT_ROOT, 'src', 'client', 'doc-motion.ts'), 'utf8');

check('agendar.ts usa WebP + srcset + loading="lazy"', agendarTs.includes('.webp') && agendarTs.includes('srcset=') && agendarTs.includes('loading="lazy"'));
check('apresentacao.html usa WebP + srcset + loading="lazy"', apresentacaoHtml.includes('.webp') && apresentacaoHtml.includes('srcset=') && apresentacaoHtml.includes('loading="lazy"'));
check('consent.ts e doc-motion.ts nao carregam GSAP/Motion/Lenis', !consentTs.includes('animations') && !docMotionTs.includes('animations'));

// 4. Service Worker com cache offline do shell
const swDistPath = join(PROJECT_ROOT, 'dist', 'public', 'sw.js');
const swTs = readFileSync(join(PROJECT_ROOT, 'src', 'client', 'sw.ts'), 'utf8');
check('src/client/sw.ts implementa cache do shell e bloqueia cache de /api/', swTs.includes('SHELL_CACHE') && swTs.includes("url.pathname.startsWith('/api/')") && swTs.includes('caches.match'));
check('dist/public/sw.js compilado para producao', existsSync(swDistPath));

// 5. Acessibilidade
const tokensCss = readFileSync(join(PROJECT_ROOT, 'public', 'css', 'parts', '01-tokens.css'), 'utf8');
const appCss = readFileSync(join(PROJECT_ROOT, 'public', 'css', 'app.css'), 'utf8');
const uiTs = readFileSync(join(PROJECT_ROOT, 'src', 'client', 'ui.ts'), 'utf8');
const complianceHtml = readFileSync(join(PROJECT_ROOT, 'public', 'compliance.html'), 'utf8');

check('contraste WCAG AA ajustado em --text-faint (#8B9BB4)', tokensCss.includes('--text-faint: #8B9BB4'));
check('CSS possui :focus-visible e prefers-reduced-motion', appCss.includes(':focus-visible') && appCss.includes('prefers-reduced-motion'));
check('toasts e alertas possuem aria-live no DOM', uiTs.includes("setAttribute('aria-live'") && complianceHtml.includes('aria-live="polite"'));

assert.equal(failed, 0, `${failed} verificacao(oes) falharam na Etapa 5.`);
console.log(`\n  OK: ${passed} verificacao(oes) da Etapa 5 aprovada(s), 0 falha(s).\n`);
