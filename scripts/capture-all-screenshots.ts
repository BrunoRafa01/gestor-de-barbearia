import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PROJECT_ROOT } from '../server/paths.js';

interface BidiResponse {
  id?: number;
  type?: string;
  error?: string;
  message?: string;
  result?: {
    contexts?: Array<{ context?: string }>;
    data?: string;
  };
}

interface ScreenshotTarget {
  name: string;
  url: string;
  viewport: { width: number; height: number };
  dpr: number;
  waitMs: number;
}

const SCREENSHOTS_DIR = resolve(PROJECT_ROOT, 'docs', 'screenshots');
const PUBLIC_SCREENS_DIR = resolve(PROJECT_ROOT, 'public', 'img', 'screens');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });
mkdirSync(PUBLIC_SCREENS_DIR, { recursive: true });

// 1. Inicia o servidor em modo demonstracao com auto-auth para capturas na porta 3498
const PORT = '3498';
const distServerPath = join(PROJECT_ROOT, 'dist', 'server', 'server.js');
const serverArgs = existsSync(distServerPath)
  ? ['--experimental-sqlite', distServerPath]
  : ['--experimental-sqlite', '--import', 'tsx', join(PROJECT_ROOT, 'server', 'server.ts')];

const server = spawn(process.execPath, serverArgs, {
  cwd: PROJECT_ROOT,
  env: {
    ...process.env,
    PORT,
    HOST: '127.0.0.1',
    DEMO_MODE: '1',
    DEMO_AUTO_AUTH: '1',
    DATABASE_PATH: join(PROJECT_ROOT, 'data', 'demo.db'),
  },
  stdio: 'ignore',
});

// Aguarda o servidor subir
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (res.status === 200) break;
  } catch {
    /* aguardando boot */
  }
  await new Promise((r) => setTimeout(r, 200));
}
console.log('Servidor pronto para captura.');

// 2. Inicia o Firefox headless com remote-debugging-port (WebDriver BiDi) e perfil isolado
const ffProfile = mkdtempSync(resolve(tmpdir(), 'gb-ff-shots-'));
const ff = spawn(
  'firefox',
  ['--headless', '--no-remote', '--profile', ffProfile, '--remote-debugging-port', '9222'],
  { stdio: 'ignore' }
);

for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version');
    if (res.ok || res.status === 404) break;
  } catch {
    /* aguardando firefox */
  }
  await new Promise((r) => setTimeout(r, 250));
}

try {
  const ws = new WebSocket('ws://127.0.0.1:9222/session');
  let id = 1;
  const pending = new Map<number, (msg: BidiResponse) => void>();

  ws.addEventListener('message', (e) => {
    const raw = typeof e.data === 'string' ? e.data : String(e.data);
    const msg = JSON.parse(raw) as BidiResponse;
    if (msg.id !== undefined) {
      const resolver = pending.get(msg.id);
      if (resolver) {
        resolver(msg);
        pending.delete(msg.id);
      }
    }
  });

  await new Promise<void>((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (err) => rej(err));
  });

  function send(method: string, params: Record<string, unknown> = {}): Promise<BidiResponse> {
    const currentId = id++;
    return new Promise<BidiResponse>((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(currentId);
        rej(new Error(`Timeout em ${method}`));
      }, 15000);
      pending.set(currentId, (msg) => {
        clearTimeout(timer);
        if (msg.type === 'error') {
          console.error(`[BiDi error em ${method}]`, msg.error, msg.message);
        }
        res(msg);
      });
      ws.send(JSON.stringify({ id: currentId, method, params }));
    });
  }

  await send('session.new', { capabilities: {} });
  const tree = await send('browsingContext.getTree', {});
  const context = tree.result?.contexts?.[0]?.context;

  const targets: ScreenshotTarget[] = [
    {
      name: 'dashboard.png',
      url: `http://127.0.0.1:${PORT}/?view=dashboard`,
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1800,
    },
    {
      name: 'agenda.png',
      url: `http://127.0.0.1:${PORT}/?view=agenda`,
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1800,
    },
    {
      name: 'relatorios.png',
      url: `http://127.0.0.1:${PORT}/?view=reports`,
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1800,
    },
    {
      name: 'clientes.png',
      url: `http://127.0.0.1:${PORT}/?view=clients`,
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1800,
    },
    {
      name: 'login.png',
      url: `http://127.0.0.1:${PORT}/?view=login`,
      viewport: { width: 1440, height: 900 },
      dpr: 1,
      waitMs: 1200,
    },
    {
      name: 'agendamento-mobile.png',
      url: `http://127.0.0.1:${PORT}/agendar`,
      viewport: { width: 390, height: 844 },
      dpr: 2,
      waitMs: 2000,
    },
    {
      name: 'apresentacao.png',
      url: `http://127.0.0.1:${PORT}/apresentacao`,
      viewport: { width: 1440, height: 900 },
      dpr: 1,
      waitMs: 2000,
    },
  ];

  for (const target of targets) {
    console.log(`Capturando ${target.name}...`);
    await send('browsingContext.setViewport', {
      context,
      viewport: target.viewport,
      devicePixelRatio: target.dpr,
    });

    await send('browsingContext.navigate', {
      context,
      url: target.url,
      wait: 'complete',
    });

    await new Promise((r) => setTimeout(r, target.waitMs));

    await send('script.evaluate', {
      expression: `(() => {
        try { localStorage.setItem('barbearia_cookie_consent', JSON.stringify({ necessary: true, timestamp: new Date().toISOString() })); } catch {}
        const b = document.getElementById('consent-banner-wrapper');
        if (b) b.remove();
      })()`,
      target: { context },
      awaitPromise: false,
    }).catch(() => {});

    await new Promise((r) => setTimeout(r, 250));

    const shot = await send('browsingContext.captureScreenshot', { context });
    if (shot.result?.data) {
      const dest = resolve(SCREENSHOTS_DIR, target.name);
      writeFileSync(dest, Buffer.from(shot.result.data, 'base64'));
      if (['dashboard.png', 'agenda.png', 'relatorios.png', 'clientes.png'].includes(target.name)) {
        copyFileSync(dest, resolve(PUBLIC_SCREENS_DIR, target.name));
      }
      console.log(`[OK] ${target.name} salva com sucesso.`);
    } else {
      console.error(`[ERRO] Falha ao capturar ${target.name}:`, shot);
    }
  }

  ws.close();
} finally {
  ff.kill();
  server.kill();
  rmSync(ffProfile, { recursive: true, force: true });
}
console.log('Todas as capturas concluidas.');
