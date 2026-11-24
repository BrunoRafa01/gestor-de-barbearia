/**
 * Escape canonico de saida HTML contra XSS em todo o front-end.
 */

export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Permite apenas URLs http(s):// ou caminhos relativos iniciados por /, bloqueando javascript:/data:. */
export function safeUrl(value: unknown, fallback = '#'): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (/^(https?:\/\/|\/(?!\/))/i.test(raw)) {
    return esc(raw);
  }
  return fallback;
}
