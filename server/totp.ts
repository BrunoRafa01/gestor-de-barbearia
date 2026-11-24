// Implementacao nativa RFC 6238 (TOTP - Time-Based One-Time Password) com HMAC-SHA1
// Compativel com Google Authenticator, Authy, 1Password, Bitwarden e Microsoft Authenticator.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;

export function encodeBase32(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31] ?? '';
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Gera segredo Base32 criptograficamente seguro (160 bits / 20 bytes). */
export function generateTotpSecret(byteLength = 20): string {
  return encodeBase32(randomBytes(byteLength));
}

/** Monta URI padrao otpauth:// para leitura via QR Code ou chave manual. */
export function buildOtpAuthUri({
  secret,
  accountName,
  issuer = 'Gestor de Barbearia',
}: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Gera o codigo TOTP de 6 digitos para um dado instante (ms). */
export function generateTotpCode(
  secret: string,
  timestampMs: number = Date.now(),
  stepSeconds: number = DEFAULT_STEP_SECONDS
): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(counterBuf).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  const otp = binary % 10 ** DEFAULT_DIGITS;
  return String(otp).padStart(DEFAULT_DIGITS, '0');
}

/** Valida codigo TOTP com tolerancia de janela (padrao +-1 passo de 30s). */
export function verifyTotpCode(
  secret: string,
  code: unknown,
  timestampMs: number = Date.now(),
  windowSteps: number = 1
): boolean {
  if (!secret || typeof code !== 'string' && typeof code !== 'number') return false;
  const normalized = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  const provided = Buffer.from(normalized, 'utf8');
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const candidate = generateTotpCode(
      secret,
      timestampMs + offset * DEFAULT_STEP_SECONDS * 1000,
      DEFAULT_STEP_SECONDS
    );
    const expected = Buffer.from(candidate, 'utf8');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return true;
    }
  }
  return false;
}
