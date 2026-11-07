// Gera ícones PNG de alta resolução para iOS (apple-touch-icon) e Android PWA
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

function crc32(buf) {
  let table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 1);
  return (c ^ (-1)) >>> 0;
}

function createPNG(size) {
  const width = size;
  const height = size;
  const buffer = Buffer.alloc((width * 4 + 1) * height);

  // Paleta minimalista escura: Fundo #0B0D12, borda suave, tesoura geométrica minimalista em branco/titânio
  const bgR = 11, bgG = 13, bgB = 18; // #0B0D12
  const iconR = 240, iconG = 243, iconB = 248; // #F0F3F8
  const borderR = 45, borderG = 50, borderB = 65;

  let offset = 0;
  const radius = size * 0.22;
  const center = size / 2;

  for (let y = 0; y < height; y++) {
    buffer[offset++] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      // Arredondamento dos cantos
      let inside = true;
      const dx = Math.max(0, Math.abs(x - center) - (center - radius));
      const dy = Math.max(0, Math.abs(y - center) - (center - radius));
      if (dx * dx + dy * dy > radius * radius) {
        inside = false;
      }

      if (!inside) {
        buffer[offset++] = 0;
        buffer[offset++] = 0;
        buffer[offset++] = 0;
        buffer[offset++] = 0;
        continue;
      }

      // Distância da borda
      const distFromEdge = Math.min(x, y, width - 1 - x, height - 1 - y);
      const isBorder = distFromEdge <= Math.max(2, size * 0.015);

      // Desenho de uma tesoura minimalista no centro
      // Normaliza coordenadas (-1 a 1)
      const nx = (x - center) / (size * 0.35);
      const ny = (y - center) / (size * 0.35);

      let isIcon = false;
      // Círculo esquerdo inferior
      const dC1 = Math.sqrt((nx + 0.45) ** 2 + (ny - 0.45) ** 2);
      if (dC1 >= 0.18 && dC1 <= 0.32) isIcon = true;

      // Círculo direito inferior
      const dC2 = Math.sqrt((nx - 0.45) ** 2 + (ny - 0.45) ** 2);
      if (dC2 >= 0.18 && dC2 <= 0.32) isIcon = true;

      // Lâmina 1 (diagonal)
      const distLine1 = Math.abs(ny - (-nx * 1.1));
      if (distLine1 < 0.08 && ny > -0.7 && ny < 0.35) isIcon = true;

      // Lâmina 2 (diagonal oposta)
      const distLine2 = Math.abs(ny - (nx * 1.1));
      if (distLine2 < 0.08 && ny > -0.7 && ny < 0.35) isIcon = true;

      // Pivô central
      const dCenter = Math.sqrt(nx * nx + ny * ny);
      if (dCenter < 0.09) isIcon = true;

      if (isIcon) {
        buffer[offset++] = iconR;
        buffer[offset++] = iconG;
        buffer[offset++] = iconB;
        buffer[offset++] = 255;
      } else if (isBorder) {
        buffer[offset++] = borderR;
        buffer[offset++] = borderG;
        buffer[offset++] = borderB;
        buffer[offset++] = 255;
      } else {
        // Fundo com leve degradê vertical
        const grad = (y / height) * 8;
        buffer[offset++] = Math.max(0, bgR - grad);
        buffer[offset++] = Math.max(0, bgG - grad);
        buffer[offset++] = Math.max(0, bgB - grad);
        buffer[offset++] = 255;
      }
    }
  }

  // PNG Construction
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT
  const compressed = deflateSync(buffer, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const toCrc = Buffer.concat([typeBuf, data]);
  const crc = crc32(toCrc);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Gera os 3 ícones fundamentais
const icon180 = createPNG(180);
const icon192 = createPNG(192);
const icon512 = createPNG(512);

writeFileSync(join(PUBLIC_DIR, 'apple-touch-icon.png'), icon180);
writeFileSync(join(PUBLIC_DIR, 'icon-192.png'), icon192);
writeFileSync(join(PUBLIC_DIR, 'icon-512.png'), icon512);

console.log('[OK] Ícones PNG gerados com sucesso para iOS e Android em public/');
