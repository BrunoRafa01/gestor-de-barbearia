// Resolucao deterministica de caminhos da raiz do projeto, funcionando tanto
// via tsx (server/*.ts) quanto no artefato compilado (dist/server/*.js).

import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const parentDir = resolve(currentDir, '..');

export const PROJECT_ROOT: string =
  basename(parentDir) === 'dist' ? resolve(parentDir, '..') : parentDir;

export const PUBLIC_DIR: string = join(PROJECT_ROOT, 'public');
export const DIST_PUBLIC_DIR: string = join(PROJECT_ROOT, 'dist', 'public');
export const DATA_DIR: string = join(PROJECT_ROOT, 'data');
