import {
  content,
  state,
} from '../panel-context.js';
import {
  esc,
  icon,
  toast,
} from '../ui.js';


/* --------------------------- Divulgação & Marketing ----------------------- */

function renderQrSvg(text: string, sizePx = 180): string {
  const dataBytes = Array.from(new TextEncoder().encode(String(text)));
  const VERSIONS: Array<{ v: number; total: number; data: number; ec: number; align: number[] }> = [
    { v: 1, total: 26, data: 19, ec: 7, align: [] },
    { v: 2, total: 44, data: 34, ec: 10, align: [6, 18] },
    { v: 3, total: 70, data: 55, ec: 15, align: [6, 22] },
    { v: 4, total: 100, data: 80, ec: 20, align: [6, 26] },
    { v: 5, total: 134, data: 108, ec: 26, align: [6, 30] },
    { v: 6, total: 172, data: 136, ec: 36, align: [6, 34] },
  ];
  const ver = VERSIONS.find((item) => dataBytes.length + 2 <= item.data) ?? VERSIONS[VERSIONS.length - 1]!;
  const maxBytes = ver.data - 2;
  const payload = dataBytes.slice(0, maxBytes);
  const bits: number[] = [];
  const pushBits = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);
  const capBits = ver.data * 8;
  pushBits(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    codewords.push(byte);
  }
  let padIdx = 0;
  while (codewords.length < ver.data) {
    codewords.push(padIdx % 2 === 0 ? 0xec : 0x11);
    padIdx += 1;
  }

  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255] ?? 0;
  const gfMul = (a: number, b: number): number =>
    a === 0 || b === 0 ? 0 : (gfExp[(gfLog[a] ?? 0) + (gfLog[b] ?? 0)] ?? 0);

  const calcEc = (dataArr: number[], ecLen: number): number[] => {
    let gen: number[] = [1];
    for (let i = 0; i < ecLen; i++) {
      const next = new Array<number>(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) {
        const gj = gen[j] ?? 0;
        next[j] = (next[j] ?? 0) ^ gj;
        next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(gj, gfExp[i] ?? 0);
      }
      gen = next;
    }
    const rem = new Array<number>(ecLen).fill(0);
    for (const d of dataArr) {
      const factor = d ^ (rem[0] ?? 0);
      rem.shift();
      rem.push(0);
      if (factor !== 0) {
        for (let i = 0; i < ecLen; i++) {
          rem[i] = (rem[i] ?? 0) ^ gfMul(gen[i + 1] ?? 0, factor);
        }
      }
    }
    return rem;
  };

  let fullStream: number[];
  if (ver.v <= 5) {
    fullStream = [...codewords, ...calcEc(codewords, ver.ec)];
  } else {
    const b1 = codewords.slice(0, 68);
    const b2 = codewords.slice(68, 136);
    const ec1 = calcEc(b1, 18);
    const ec2 = calcEc(b2, 18);
    fullStream = [];
    for (let i = 0; i < 68; i++) fullStream.push(b1[i] ?? 0, b2[i] ?? 0);
    for (let i = 0; i < 18; i++) fullStream.push(ec1[i] ?? 0, ec2[i] ?? 0);
  }

  const size = ver.v * 4 + 17;
  const grid = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFixed = (r: number, c: number, val: number): void => {
    const row = grid[r];
    const resRow = reserved[r];
    if (r >= 0 && r < size && c >= 0 && c < size && row && resRow) {
      row[c] = val;
      resRow[c] = 1;
    }
  };
  const placeFinder = (r0: number, c0: number): void => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inBox = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFixed(r0 + r, c0 + c, inBox && (onBorder || inCore) ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  const alignPos = ver.align[1];
  if (alignPos !== undefined) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const val = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0) ? 1 : 0;
        setFixed(alignPos + r, alignPos + c, val);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    setFixed(6, i, i % 2 === 0 ? 1 : 0);
    setFixed(i, 6, i % 2 === 0 ? 1 : 0);
  }
  setFixed(4 * ver.v + 9, 8, 1);

  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      if (reserved[8]) reserved[8]![i] = 1;
      if (reserved[i]) reserved[i]![8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    if (reserved[8]) reserved[8]![size - 1 - i] = 1;
    if (reserved[size - 1 - i]) reserved[size - 1 - i]![8] = 1;
  }

  const streamBits: number[] = [];
  for (const byte of fullStream) {
    for (let i = 7; i >= 0; i--) streamBits.push((byte >>> i) & 1);
  }
  let bitIdx = 0;
  let dir = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step++) {
      const r = dir === -1 ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (!reserved[r]?.[c] && grid[r]) {
          const bit = bitIdx < streamBits.length ? (streamBits[bitIdx++] ?? 0) : 0;
          grid[r]![c] = (r + c) % 2 === 0 ? bit ^ 1 : bit;
        }
      }
    }
    dir = -dir;
  }

  const fmtBits = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const bit = (fmtBits >>> (14 - i)) & 1;
    if (i < 6 && grid[8]) grid[8]![i] = bit;
    else if (i < 8 && grid[8]) grid[8]![i + 1] = bit;
    else if (grid[size - 15 + i]) grid[size - 15 + i]![8] = bit;

    if (i < 8 && grid[size - 1 - i]) grid[size - 1 - i]![8] = bit;
    else if (i < 9 && grid[7]) grid[7]![8] = bit;
    else if (grid[14 - i]) grid[14 - i]![8] = bit;
  }

  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r]?.[c] === 1) {
        rects += `<rect x="${c + 2}" y="${r + 2}" width="1" height="1" fill="#080B12"/>`;
      }
    }
  }
  const vb = size + 4;
  return `<svg viewBox="0 0 ${vb} ${vb}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" style="background:#FFFFFF;border-radius:12px" aria-label="QR Code para agendamento">${rects}</svg>`;
}

export async function viewMarketing(): Promise<void> {
  const shopName = state.settings.shop_name || 'Nova Barbearia';
  const shopAddress = state.settings.shop_address || 'Av. Modelo, 100, Cidade Fictícia - SP';
  const shopInstagram = state.settings.shop_instagram || '@novabarbearia.oficial';
  const publicUrl = `${window.location.origin}/agendar`;
  const customShopUrl = `${window.location.origin}/b/nova-barbearia`;

  const qrSvg = renderQrSvg(publicUrl, 180);

  content().innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header">
          <h2>Link de Agendamento da Bio</h2>
          <span class="card-sub">Instagram &bull; WhatsApp &bull; TikTok</span>
        </div>
        <p class="muted" style="font-size:13px;line-height:1.5">
          Coloque este link na biografia do seu Instagram para receber agendamentos diretamente pelo celular dos clientes:
        </p>

        <div class="field" style="margin-top:14px">
          <label>Link Direto Oficial</label>
          <div style="display:flex;gap:8px">
            <input class="control mono" id="mkt-url" readonly value="${esc(publicUrl)}" style="flex:1" />
            <button class="btn btn-primary" id="btn-copy-url" type="button">${icon('clipboard')} Copiar</button>
          </div>
        </div>

        <div class="field" style="margin-top:14px">
          <label>Link Personalizado Multi-barbearia</label>
          <div style="display:flex;gap:8px">
            <input class="control mono" id="mkt-tenant-url" readonly value="${esc(customShopUrl)}" style="flex:1" />
            <button class="btn" id="btn-copy-tenant" type="button">${icon('clipboard')} Copiar</button>
          </div>
        </div>

        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn-ghost" href="${esc(publicUrl)}" target="_blank" rel="noopener">
            ${icon('calendar')} Abrir Página Pública &rarr;
          </a>
          <button class="btn btn-whats" id="btn-share-wa" type="button">
            ${icon('whatsapp')} Compartilhar no WhatsApp
          </button>
        </div>
      </div>

      <div class="card" style="text-align:center">
        <div class="card-header">
          <h2>QR Code para Balcão e Espelho</h2>
          <span class="card-sub">Material Físico</span>
        </div>
        <p class="muted" style="font-size:13px;text-align:center;margin-bottom:16px">
          Imprima este QR Code em acrílico ou adesivo para seus clientes marcarem o próximo horário antes de sair da cadeira.
        </p>

        <div style="display:inline-block;padding:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.4)">
          ${qrSvg}
        </div>

        <div style="margin-top:20px;display:flex;justify-content:center;gap:10px">
          <button class="btn btn-primary" id="btn-print-qr" type="button">
            ${icon('printer')} Imprimir Display para Balcão
          </button>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:20px">
      <div class="card">
        <div class="card-header">
          <h2>Cartão Digital Interativo</h2>
          <span class="card-sub">Perfeito para enviar no WhatsApp e Stories</span>
        </div>
        <div style="max-width:320px;margin:16px auto;background:linear-gradient(145deg, #101622 0%, #141C2D 100%);border:1px solid var(--border);border-radius:20px;padding:24px;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,0.5)">
          <div style="width:56px;height:56px;margin:0 auto 12px;background:#080B12;border:2px solid var(--primary);border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--primary)">
            ${icon('scissors')}
          </div>
          <h3 style="color:#FFFFFF;margin:0 0 4px;font-size:18px">${esc(shopName)}</h3>
          <p style="color:var(--text-dim);font-size:12px;margin:0 0 16px">${esc(shopAddress)}</p>
          <div style="background:#FFFFFF;padding:8px;border-radius:10px;display:inline-block;margin-bottom:14px">
            <div style="width:120px;height:120px;display:flex;align-items:center;justify-content:center">
              ${qrSvg.replace('width="180"', 'width="120"').replace('height="180"', 'height="120"')}
            </div>
          </div>
          <div style="font-size:11px;color:var(--primary);font-weight:600;margin-bottom:12px">
            Aponte a câmera e agende online
          </div>
          <div style="font-size:11.5px;color:var(--text-dim)">
            Instagram: <strong style="color:#FFFFFF">${esc(shopInstagram)}</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Texto Pronto para Divulgação</h2>
          <span class="card-sub">Copie e cole em redes sociais</span>
        </div>
        <div class="field">
          <label>Legenda para Post / Stories no Instagram</label>
          <textarea class="control" id="mkt-post-text" rows="5" readonly style="font-size:13px;line-height:1.5">Fala galera! 💈✂️
Para sua comodidade, agora você pode agendar seu horário na ${esc(shopName)} em menos de 1 minuto diretamente pelo celular, sem precisar baixar nada!

👉 Basta acessar o link da nossa bio:
${esc(publicUrl)}

Escolha seu barbeiro, o melhor horário e receba a confirmação na hora! Te esperamos na cadeira. 🔥</textarea>
          <button class="btn btn-sm" id="btn-copy-post" type="button" style="margin-top:8px">
            ${icon('clipboard')} Copiar Texto para Instagram
          </button>
        </div>

        <div style="margin-top:24px;padding:16px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);border-radius:12px">
          <strong style="color:var(--primary-hover);display:block;margin-bottom:4px">💡 Dica Nova Runtime:</strong>
          <p class="muted" style="font-size:12.5px;margin:0">
            Adicione o adesivo "Link" nos stories semanais do Instagram direcionando para <code>${esc(publicUrl)}</code>. Nossos testes mostram um aumento de 42% no preenchimento de horários vazios de terça a quinta-feira!
          </p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-copy-url')?.addEventListener('click', () => {
    navigator.clipboard
      .writeText(publicUrl)
      .then(() => toast('Link público copiado!', 'ok'))
      .catch(() => toast('Não foi possível copiar automaticamente.', 'error'));
  });

  document.getElementById('btn-copy-tenant')?.addEventListener('click', () => {
    navigator.clipboard
      .writeText(customShopUrl)
      .then(() => toast('Link personalizado copiado!', 'ok'))
      .catch(() => toast('Não foi possível copiar automaticamente.', 'error'));
  });

  document.getElementById('btn-copy-post')?.addEventListener('click', () => {
    const text = (document.getElementById('mkt-post-text') as HTMLTextAreaElement | null)?.value ?? '';
    navigator.clipboard
      .writeText(text)
      .then(() => toast('Texto para Instagram copiado!', 'ok'))
      .catch(() => toast('Não foi possível copiar automaticamente.', 'error'));
  });

  document.getElementById('btn-share-wa')?.addEventListener('click', () => {
    const text = encodeURIComponent(`Olá! Agende seu horário na ${shopName} pelo link: ${publicUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
  });

  document.getElementById('btn-print-qr')?.addEventListener('click', () => {
    const printWin = window.open('', '_blank');
    if (!printWin) {
      toast('Permita pop-ups neste site para imprimir o display de balcão.', 'warn');
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Display de Balcão - ${esc(shopName)}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; text-align: center; margin: 0; padding: 40px; color: #080B12; background: #FFFFFF; }
          .container { max-width: 480px; margin: 0 auto; border: 3px solid #080B12; border-radius: 24px; padding: 48px 32px; box-sizing: border-box; }
          h1 { font-size: 28px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px; }
          p { font-size: 16px; color: #475569; margin: 0 0 24px; }
          .qr-box { margin: 24px 0; }
          .cta { font-size: 20px; font-weight: 700; color: #2563EB; margin: 18px 0 6px; }
          .sub { font-size: 13px; color: #64748B; }
          .footer { margin-top: 32px; font-size: 14px; border-top: 1px solid #E2E8F0; padding-top: 16px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${esc(shopName)}</h1>
          <p>Agendamento Rápido &bull; Sem Filas</p>
          <div class="cta">Aponte a câmera do seu celular</div>
          <div class="sub">Escolha seu serviço, barbeiro e horário em 1 minuto</div>
          <div class="qr-box">${qrSvg}</div>
          <div class="footer">${esc(shopAddress)} &bull; ${esc(shopInstagram)}</div>
        </div>
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  });
}

