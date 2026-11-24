// Gestor de Barbearia - servidor HTTP (TypeScript estrito)
//
// Executa com:  npm run dev   (ou)   npm start

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import {
  assertActiveSession,
  ensureAdminPassword,
  isUsingDefaultPassword,
  validateActiveSession,
} from './auth.js';
import { closeDatabase, driverKind, driverLabel, get, initDatabase } from './db.js';
import { isDemoMode, seedDemoData } from './demo.js';
import { HttpError, readJsonBody, sendError, sendJson, serveStatic } from './http.js';
import { logStructuredError } from './logger.js';
import { DATA_DIR, DIST_PUBLIC_DIR, PROJECT_ROOT, PUBLIC_DIR } from './paths.js';
import { apiRoutes } from './routes/index.js';
import { applySecurityHeaders, isSecureRequest, newRequestId } from './security.js';
import type { AppRequest, RouteDefinition, RouteResult } from './types.js';
import { startWhatsAppWorker, stopWhatsAppWorker } from './whatsapp-cloud.js';

/* ----------------------------- Configuracao ------------------------------- */

function loadEnvFile(filePath: string): void {
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

loadEnvFile(join(PROJECT_ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_PATH = process.env.DATABASE_PATH || join(DATA_DIR, 'barbearia.db');
const BODY_LIMIT_BYTES = 512 * 1024;

/* -------------------------------- Roteador -------------------------------- */

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const segment = patternParts[index];
    const currentPath = pathParts[index];
    if (segment === undefined || currentPath === undefined) return null;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(currentPath);
    } else if (segment !== currentPath) {
      return null;
    }
  }
  return params;
}

function findRoute(
  method: string | undefined,
  pathname: string
): { route: RouteDefinition; params: Record<string, string> } | null {
  const routes = apiRoutes as readonly RouteDefinition[];
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

function isApiPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/');
}

const PAGE_ALIASES: Readonly<Record<string, string>> = {
  '/': 'index.html',
  '/index': 'index.html',
  '/index.html': 'index.html',
  '/painel': 'index.html',
  '/agendar': 'agendar.html',
  '/agendar.html': 'agendar.html',
  '/termos': 'termos.html',
  '/termos.html': 'termos.html',
  '/privacidade': 'privacidade.html',
  '/privacidade.html': 'privacidade.html',
  '/cookies': 'cookies.html',
  '/cookies.html': 'cookies.html',
  '/compliance': 'compliance.html',
  '/compliance.html': 'compliance.html',
  '/transparencia': 'transparencia.html',
  '/transparencia.html': 'transparencia.html',
};

/**
 * Valida a origem da requisicao (protecao CSRF) verificando `url.hostname`,
 * esquema HTTP/HTTPS (exigindo HTTPS em producao) e rejeitando `Origin: null`.
 */
export function validateOrigin(request: AppRequest): boolean {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  const pathname = String(request.url || '').split('?')[0] ?? '';
  if (pathname === '/api/whatsapp/webhook') return true;

  const isProd = process.env.NODE_ENV === 'production';
  const rawOriginHeader = request.headers.origin ?? request.headers.referer;
  const origin = Array.isArray(rawOriginHeader) ? rawOriginHeader[0] : rawOriginHeader;
  if (!origin) {
    return !isProd;
  }
  if (origin.trim().toLowerCase() === 'null') {
    return false;
  }

  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    if (isProd && url.protocol !== 'https:') {
      return false;
    }

    const trustProxy = process.env.TRUST_PROXY === 'true';
    const rawHostHeader =
      (trustProxy ? request.headers['x-forwarded-host'] : undefined) ?? request.headers.host;
    const rawHost = Array.isArray(rawHostHeader) ? rawHostHeader[0] : rawHostHeader;
    const hostHeader = typeof rawHost === 'string' ? (rawHost.split(',')[0]?.trim() ?? '') : '';
    if (!hostHeader) {
      return !isProd;
    }

    const expectedUrl = new URL(`http://${hostHeader}`);
    const expectedHost = expectedUrl.hostname.toLowerCase();
    const actualHost = url.hostname.toLowerCase();
    if (!expectedHost || !actualHost) {
      return false;
    }

    const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
    const isDevLocalMatch =
      !isProd && localHosts.has(expectedHost) && localHosts.has(actualHost);

    if (actualHost !== expectedHost && !isDevLocalMatch) {
      return false;
    }
    if (expectedUrl.port && url.port && expectedUrl.port !== url.port && !isDevLocalMatch) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function translateError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('UNIQUE constraint failed') && message.includes('appointments')) {
    return new HttpError(409, 'Ja existe um agendamento neste horario para este profissional.');
  }
  if (message.includes('UNIQUE constraint failed') && message.includes('clients')) {
    return new HttpError(409, 'Ja existe um cliente cadastrado com este telefone.');
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new HttpError(
      409,
      'Este registro esta sendo usado por um agendamento e nao pode ser excluido.'
    );
  }
  return error;
}

/**
 * Serve ativos estaticos priorizando `DIST_PUBLIC_DIR` (JS compilado do frontend)
 * e caindo para `PUBLIC_DIR` (HTML, CSS, imagens e assets estaticos).
 */
function servePublicFile(request: AppRequest, response: ServerResponse, target: string): boolean {
  return (
    serveStatic(request, response, DIST_PUBLIC_DIR, target) ||
    serveStatic(request, response, PUBLIC_DIR, target)
  );
}

/* ------------------------------- Servidor --------------------------------- */

const server = createServer(async (req, response) => {
  const request = req as AppRequest;
  const requestId = newRequestId();
  const secure = isSecureRequest(request);
  applySecurityHeaders(response, { secure, requestId });

  let url: URL;
  let pathname: string;
  try {
    url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
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

      const session =
        match.route.auth !== false
          ? await assertActiveSession(request, response)
          : await validateActiveSession(request, response);

      if (match.route.auth !== false) {
        if (!isDemoMode() && isUsingDefaultPassword() && pathname !== '/api/settings/password') {
          throw new HttpError(
            403,
            'Troca obrigatoria da senha inicial antes de acessar o painel.'
          );
        }
      }

      const methodUpper = (request.method ?? 'GET').toUpperCase();
      const body = ['POST', 'PUT', 'PATCH'].includes(methodUpper)
        ? await readJsonBody<Record<string, unknown>>(
            request,
            match.route.bodyLimit || BODY_LIMIT_BYTES
          )
        : {};
      const query = Object.fromEntries(url.searchParams.entries());

      const shopId = Number(session?.shopId ?? session?.shop_id) || 1;
      const isMaster = session?.role === 'master';

      if (match.route.masterOnly) {
        if (!isMaster) {
          throw new HttpError(403, 'Acesso restrito a administradores master da Nova Runtime.');
        }
        if (!session?.mfa) {
          throw new HttpError(
            403,
            'Autenticacao em duas etapas (2FA/TOTP) obrigatoria para acessar o Painel Master.'
          );
        }
      }

      if (
        match.route.auth !== false &&
        session &&
        !isMaster &&
        !pathname.startsWith('/api/master') &&
        !pathname.startsWith('/api/auth')
      ) {
        const shopRow = await get('SELECT active FROM barbershops WHERE id = ?', [shopId]);
        if (shopRow && Number(shopRow['active']) === 0) {
          throw new HttpError(
            403,
            'Conta da barbearia suspensa. Entre em contato com o suporte da Nova Runtime.'
          );
        }
      }

      const result = (await match.route.handler({
        req: request,
        res: response,
        url,
        params: match.params,
        query,
        body,
        session,
        shopId,
        isMaster,
      })) as RouteResult | Record<string, unknown> | null;

      if (response.writableEnded) return;

      if (result && typeof result === 'object') {
        const envelope = result as RouteResult;
        const hasEnvelopeKey =
          'status' in envelope || 'body' in envelope || 'headers' in envelope || 'raw' in envelope;

        if (hasEnvelopeKey) {
          const status = typeof envelope.status === 'number' ? envelope.status : 200;
          if (envelope.headers) {
            for (const [headerName, headerValue] of Object.entries(envelope.headers)) {
              response.setHeader(headerName, headerValue);
            }
          }
          if (envelope.raw) {
            const rawBody =
              typeof envelope.body === 'string' || Buffer.isBuffer(envelope.body)
                ? envelope.body
                : String(envelope.body ?? '');
            if (!response.getHeader('Content-Type')) {
              response.setHeader('Content-Type', 'text/plain; charset=utf-8');
            }
            response.setHeader('Content-Length', Buffer.byteLength(rawBody));
            response.writeHead(status);
            response.end(rawBody);
            return;
          }
          sendJson(response, status, 'body' in envelope ? envelope.body : envelope);
          return;
        }
      }

      sendJson(response, 200, result);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(response, 405, 'Metodo nao permitido.');
      return;
    }

    // Rotas de barbearias multi-tenant (/b/:slug) e autoatendimento (/agendamento/:token)
    if (pathname.startsWith('/b/') || /^\/agendamento\/[a-f0-9]{16,64}$/i.test(pathname)) {
      if (servePublicFile(request, response, 'agendar.html')) return;
    }

    // Modo demonstracao e Apresentacao Comercial Nova Runtime
    if (pathname === '/demo' || pathname === '/demo/') {
      if (servePublicFile(request, response, 'index.html')) return;
    }
    if (pathname === '/apresentacao' || pathname === '/apresentacao/') {
      if (servePublicFile(request, response, 'apresentacao.html')) return;
    }

    if (pathname.startsWith('/img/screens/')) {
      const fileName = pathname.slice('/img/screens/'.length);
      if (/^[a-z0-9._-]+\.png$/i.test(fileName)) {
        const screenPath = join(PROJECT_ROOT, 'docs', 'screenshots', fileName);
        if (existsSync(screenPath)) {
          response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
          response.end(readFileSync(screenPath));
          return;
        }
      }
    }

    const alias = PAGE_ALIASES[pathname.replace(/\/$/, '') || '/'];
    if (alias && servePublicFile(request, response, alias)) return;
    if (servePublicFile(request, response, pathname)) return;

    if (!servePublicFile(request, response, '404.html')) {
      sendError(response, 404, 'Pagina nao encontrada.');
    }
  } catch (error) {
    const httpError = translateError(error);
    if (!(httpError instanceof HttpError)) {
      logStructuredError(error, {
        requestId,
        method: request.method,
        path: pathname,
        status: 500,
      });
      const isProd = process.env.NODE_ENV === 'production';
      const errMsg = error instanceof Error ? error.message : String(error);
      sendError(
        response,
        500,
        'Erro interno no servidor.',
        isProd ? undefined : errMsg
      );
      return;
    }
    sendError(response, httpError.status, httpError.message, httpError.details);
  }
});

function localAddresses(): string[] {
  const addresses: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

function isLocalSqlite(): boolean {
  return driverKind() === 'sqlite' && existsSync(DATABASE_PATH);
}

function printBanner(): void {
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

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    if (isDemoMode()) {
      throw new Error('DEMO_MODE=1 nao e permitido em producao.');
    }
    if (!process.env.TURSO_DATABASE_URL && process.env.ALLOW_EPHEMERAL_SQLITE !== '1') {
      throw new Error(
        'TURSO_DATABASE_URL e obrigatoria em producao para evitar perda de dados (ou defina ALLOW_EPHEMERAL_SQLITE=1).'
      );
    }
  }

  await initDatabase({ path: DATABASE_PATH });

  const initialPassword = process.env.ADMIN_PASSWORD;
  const { created, generatedPassword, weakPassword } = await ensureAdminPassword(initialPassword, {
    isDefault: !initialPassword,
  });
  if (created) {
    console.log(
      generatedPassword
        ? `[setup] Senha inicial provisoria gerada: ${generatedPassword} (troca obrigatoria no primeiro acesso).`
        : weakPassword
          ? '[setup] ADMIN_PASSWORD fraca detectada: troca obrigatoria sera exigida no primeiro acesso.'
          : '[setup] Senha inicial do painel criada a partir da variavel ADMIN_PASSWORD.'
    );
  }

  if (isDemoMode()) {
    const { seeded, appointments } = await seedDemoData();
    if (seeded) console.log(`[demo] Dados ficticios criados (${appointments} agendamentos).`);
    console.log('[demo] MODO DEMONSTRACAO ativo: nenhum dado real e exibido ou gravado.');
  }

  startWhatsAppWorker();
  server.listen(PORT, HOST, printBanner);
}

function shutdown(signal: string): void {
  console.log(`\n${signal} recebido. Encerrando o Gestor de Barbearia...`);
  stopWhatsAppWorker();
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

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[promise-rejeitada]', reason);
});

bootstrap().catch((error: unknown) => {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error('[fatal] Nao foi possivel iniciar o servidor:', errMsg);
  process.exit(1);
});
