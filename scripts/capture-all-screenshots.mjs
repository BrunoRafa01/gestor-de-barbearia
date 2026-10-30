import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCREENSHOTS_DIR = resolve(ROOT, 'docs', 'screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// 1. Inicia o servidor em modo demonstracao com auto-auth para capturas
const server = spawn(process.execPath, ['--experimental-sqlite', 'server/server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: '3000',
    HOST: '127.0.0.1',
    DEMO_MODE: '1',
    DEMO_AUTO_AUTH: '1',
    DATABASE_PATH: 'data/demo.db',
  },
  stdio: 'ignore',
});

// Aguarda o servidor subir
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch('http://127.0.0.1:3000/health');
    if (res.status === 200) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
console.log('Servidor pronto para captura.');

// 2. Inicia o Firefox headless com remote-debugging-port (WebDriver BiDi)
const ff = spawn('firefox', [
  '--headless',
  '--remote-debugging-port', '9222',
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 2500));

try {
  const ws = new WebSocket('ws://127.0.0.1:9222/session');
  let id = 1;
  const pending = new Map();

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  function send(method, params = {}) {
    const currentId = id++;
    return new Promise((res) => {
      pending.set(currentId, res);
      ws.send(JSON.stringify({ id: currentId, method, params }));
    });
  }

  await send('session.new', { capabilities: {} });
  const tree = await send('browsingContext.getTree', {});
  const context = tree.result?.contexts?.[0]?.context;

  const targets = [
    {
      name: 'dashboard.png',
      url: 'http://127.0.0.1:3000/?view=dashboard',
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1500,
    },
    {
      name: 'agenda.png',
      url: 'http://127.0.0.1:3000/?view=agenda',
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1500,
    },
    {
      name: 'relatorios.png',
      url: 'http://127.0.0.1:3000/?view=reports',
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1500,
    },
    {
      name: 'clientes.png',
      url: 'http://127.0.0.1:3000/?view=clients',
      viewport: { width: 1440, height: 1000 },
      dpr: 1,
      waitMs: 1500,
    },
    {
      name: 'login.png',
      url: 'http://127.0.0.1:3000/?view=login',
      viewport: { width: 1440, height: 900 },
      dpr: 1,
      waitMs: 1000,
    },
    {
      name: 'agendamento-mobile.png',
      url: 'http://127.0.0.1:3000/agendar',
      viewport: { width: 390, height: 844 },
      dpr: 2,
      waitMs: 1500,
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

    const shot = await send('browsingContext.captureScreenshot', { context });
    if (shot.result?.data) {
      const dest = resolve(SCREENSHOTS_DIR, target.name);
      writeFileSync(dest, Buffer.from(shot.result.data, 'base64'));
      console.log(`[OK] ${target.name} salva com sucesso.`);
    } else {
      console.error(`[ERRO] Falha ao capturar ${target.name}:`, shot);
    }
  }

  ws.close();
} finally {
  ff.kill();
  server.kill();
}
console.log('Todas as capturas concluidas.');
