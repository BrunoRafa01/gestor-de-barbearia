// Pipeline de build de producao 100% TypeScript — Gestor de Barbearia (NOVA RUNTIME)
// 1. Limpa dist/
// 2. Compila backend, scripts e suites de teste com tsc (tsconfig.server.json) -> dist/
// 3. Empacota e otimiza os modulos do navegador (src/client/*.ts + src/animations/*.ts) -> dist/public/

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const currentDir = dirname(fileURLToPath(import.meta.url));
const parentDir = resolve(currentDir, '..');
const ROOT = parentDir.endsWith('/dist') || parentDir.endsWith('\\dist')
  ? resolve(parentDir, '..')
  : parentDir;

const DIST_DIR = join(ROOT, 'dist');
const DIST_PUBLIC_JS = join(DIST_DIR, 'public', 'js');
const DIST_PUBLIC = join(DIST_DIR, 'public');

async function runBuild(): Promise<void> {
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true, force: true });
  }
  mkdirSync(DIST_PUBLIC_JS, { recursive: true });

  const tscBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  execFileSync(tscBin, ['-p', join(ROOT, 'tsconfig.server.json')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const clientEntries = [
    join(ROOT, 'src', 'client', 'app.ts'),
    join(ROOT, 'src', 'client', 'agendar.ts'),
    join(ROOT, 'src', 'client', 'apresentacao.ts'),
    join(ROOT, 'src', 'client', 'compliance.ts'),
    join(ROOT, 'src', 'client', 'consent.ts'),
    join(ROOT, 'src', 'client', 'doc-motion.ts'),
  ].filter((entry) => existsSync(entry));

  if (clientEntries.length > 0) {
    await esbuild({
      entryPoints: clientEntries,
      outdir: DIST_PUBLIC_JS,
      bundle: true,
      splitting: true,
      format: 'esm',
      target: ['es2022'],
      minify: true,
      sourcemap: false,
      legalComments: 'none',
      chunkNames: 'chunks/[name]-[hash]',
    });
  }

  const swEntry = join(ROOT, 'src', 'client', 'sw.ts');
  if (existsSync(swEntry)) {
    await esbuild({
      entryPoints: [swEntry],
      outfile: join(DIST_PUBLIC, 'sw.js'),
      bundle: true,
      format: 'iife',
      target: ['es2022'],
      minify: true,
      sourcemap: false,
      legalComments: 'none',
    });
  }

  const cssPartsDir = join(ROOT, 'public', 'css', 'parts');
  if (existsSync(cssPartsDir)) {
    const parts = readdirSync(cssPartsDir)
      .filter((name) => name.endsWith('.css'))
      .sort();
    if (parts.length > 0) {
      const combined = parts.map((name) => readFileSync(join(cssPartsDir, name), 'utf8').trimEnd()).join('\n\n') + '\n';
      writeFileSync(join(ROOT, 'public', 'css', 'app.css'), combined);
    }
  }

  console.log('[build] Artefatos JavaScript e CSS gerados com sucesso em dist/ (TypeScript 100%).');
}

runBuild().catch((err: unknown) => {
  console.error('[build] Falha na compilacao:', err);
  process.exit(1);
});
