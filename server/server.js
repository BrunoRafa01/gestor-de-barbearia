// Gestor de Barbearia - servidor HTTP
//
// Executa com:  npm start   (ou)   node server/server.js

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAuthenticated, ensureAdminPassword } from './auth.js';
import { closeDatabase, driverKind, driverLabel, initDatabase } from './db.js';
import { isDemoMode, seedDemoData } from './demo.js';
import { HttpError, readJsonBody, sendError, sendJson, serveStatic } from './http.js';
import { applySecurityHeaders, isSecureRequest, newRequestId } from './security.js';
import { apiRoutes } from './routes/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const PUBLIC_DIR = join(ROOT_DIR, 'public');

/* ----------------------------- Configuracao ------------------------------- */

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(join(ROOT_DIR, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_PATH = process.env.DATABASE_PATH || join(ROOT_DIR, 'data', 'barbearia.db');
const BODY_LIMIT_BYTES = 512 * 1024;

/* -------------------------------- Roteador -------------------------------- */

function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const segment = patternParts[index];
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(pathParts[index]);
    } else if (segment !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

function findRoute(method, pathname) {
  for (const route of apiRoutes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

function isApiPath(pathname) {
  return pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/');
}

const PAGE_ALIASES = {
  '/': 'index.html',
  '/index': 'index.html',
  '/index.html': 'index.html',
  '/painel': 'index.html',
  '/agendar': 'agendar.html',
  '/agendar.html': 'agendar.html',
};

function validateOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method || '')) return true;
  const origin = request.headers.origin || request.headers.referer;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const hostHeader = request.headers.host;
    if (hostHeader) {
      const expectedHost = hostHeader.toLowerCase().split(':')[0];
      const actualHost = originUrl.hostname.toLowerCase();
      if (
        actualHost !== expectedHost &&
        actualHost !== 'localhost' &&
        actualHost !== '127.0.0.1' &&
        actualHost !== '0.0.0.0'
      ) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}

function translateError(error) {
  const message = String(error?.message || '');
  if (message.includes('UNIQUE constraint failed') && message.includes('appointments')) {
    return new HttpError(409, 'Ja existe um agendamento neste horario para este profissional.');
  }
  if (message.includes('UNIQUE constraint failed') && message.includes('clients')) {
    return new HttpError(409, 'Ja existe um cliente cadastrado com este telefone.');
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new HttpError(409, 'Este registro esta sendo usado por um agendamento e nao pode ser excluido.');
  }
  return error;
}

/* ------------------------------- Servidor --------------------------------- */

const server = createServer(async (request, response) => {
  const requestId = newRequestId();
  const secure = isSecureRequest(request);
  applySecurityHeaders(response, { secure, requestId });

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  let pathname = '/';
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendError(response, 400, 'Endereco invalido.');
    return;
  }

  try {
    if (isApiPath(pathname)) {
      if (!validateOrigin(request)) {
        sendError(response, 403, 'Origem nao autorizada (protecao CSRF).');
        return;
      }

      const match = findRoute(request.method, pathname);
      if (!match) {
        sendError(response, 404, 'Endpoint nao encontrado.');
        return;
      }

      if (match.route.auth !== false) {
        assertAuthenticated(request);
      }

      const body = ['POST', 'PUT', 'PATCH'].includes(request.method)
        ? await readJsonBody(request, match.route.bodyLimit || BODY_LIMIT_BYTES)
        : {};
      const query = Object.fromEntries(url.searchParams.entries());

      const result = await match.route.handler({
        req: request,
        res: response,
        params: match.params,
        query,
        body,
      });

      sendJson(response, result?.status || 200, result?.body);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(response, 405, 'Metodo nao permitido.');
      return;
    }

    const alias = PAGE_ALIASES[pathname.replace(/\/$/, '') || '/'];
    if (alias && serveStatic(request, response, PUBLIC_DIR, alias)) return;
    if (serveStatic(request, response, PUBLIC_DIR, pathname)) return;

    serveStatic(request, response, PUBLIC_DIR, '404.html') ||
      sendError(response, 404, 'Pagina nao encontrada.');
  } catch (error) {
    const httpError = translateError(error);
    if (!(httpError instanceof HttpError)) {
      console.error(`[erro:${requestId}]`, error);
      const isProd = process.env.NODE_ENV === 'production';
      sendError(
        response,
        500,
        'Erro interno no servidor.',
        isProd ? undefined : String(error?.message || error)
      );
      return;
    }
    sendError(response, httpError.status, httpError.message, httpError.details);
  }
});

function localAddresses() {
  const addresses = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

function isLocalSqlite() {
  return driverKind() === 'sqlite' && existsSync(DATABASE_PATH);
}

function printBanner() {
  const usingTurso = driverKind() === 'turso';
  console.log('');
  console.log('  Gestor de Barbearia  |  Sistema de Gestão');
  console.log('  ---------------------------------------------');
  console.log(`  Painel:      http://localhost:${PORT}/`);
  console.log(`  Agendamento: http://localhost:${PORT}/agendar`);
  console.log(`  Health:      http://localhost:${PORT}/health`);
  for (const address of localAddresses()) {
    console.log(`  Celular:     http://${address}:${PORT}/agendar`);
  }
  console.log(`  Banco:       ${driverLabel()} (${driverKind()})`);
  if (usingTurso) console.log('  Persistencia: Turso/libSQL (duravel na nuvem)');
  if (isDemoMode()) console.log('  Modo:        DEMONSTRACAO (dados ficticios - nao sao reais)');
  console.log('  ---------------------------------------------');
  console.log('  Pressione Ctrl+C para encerrar.');
  console.log('');
  if (!usingTurso && isLocalSqlite() && statSync(DATABASE_PATH).size < 20480) {
    console.log('  Dica: comece cadastrando servicos e profissionais para liberar a agenda.');
    console.log('');
  }
}

async function bootstrap() {
  await initDatabase({ path: DATABASE_PATH });

  const initialPassword = process.env.ADMIN_PASSWORD;
  const created = await ensureAdminPassword(initialPassword || 'admin123', {
    isDefault: !initialPassword,
  });
  if (created) {
    console.log(
      initialPassword
        ? '[setup] Senha inicial do painel criada a partir da variavel ADMIN_PASSWORD.'
        : '[setup] Senha inicial "admin123" criada. Troque-a em Configuracoes.'
    );
  }

  if (isDemoMode()) {
    const { seeded, appointments } = await seedDemoData();
    if (seeded) console.log(`[demo] Dados ficticios criados (${appointments} agendamentos).`);
    console.log('[demo] MODO DEMONSTRACAO ativo: nenhum dado real e exibido ou gravado.');
  }

  server.listen(PORT, HOST, printBanner);
}

function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando o Gestor de Barbearia...`);
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  } else if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
  server.close(async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
  // Garante o encerramento mesmo se alguma conexao ficar pendurada.
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[promise-rejeitada]', reason);
});

bootstrap().catch((error) => {
  console.error('[fatal] Nao foi possivel iniciar o servidor:', error?.message || error);
  process.exit(1);
});
