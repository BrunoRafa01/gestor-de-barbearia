/**
 * Animações vetoriais Lottie (lottie_light SVG, sem eval/new Function — 100% compatível com CSP script-src 'self').
 * Carregado sob demanda (dynamic import) para estados de loading, confirmação de agendamento e empty states.
 */

import type { LottieInstance } from 'lottie-web/build/player/esm/lottie_light.min.js';
import { isReducedMotion } from './micro-motion.js';

export type LottiePreset = 'loading' | 'success' | 'empty';

const activeInstances = new WeakMap<Element, LottieInstance>();

/** JSON vetorial minimalista: anel de carregamento azul #3B82F6 -> #60A5FA */
const LOADING_JSON: Record<string, unknown> = {
  v: '5.7.4',
  fr: 60,
  ip: 0,
  op: 60,
  w: 64,
  h: 64,
  nm: 'nr-loading',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'ring',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 1, k: [{ t: 0, s: [0], e: [360] }, { t: 60, s: [360] }] },
        p: { a: 0, k: [32, 32, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      shapes: [
        {
          ty: 'el',
          p: { a: 0, k: [0, 0] },
          s: { a: 0, k: [44, 44] },
        },
        {
          ty: 'tm',
          s: { a: 0, k: 8 },
          e: { a: 0, k: 74 },
          o: { a: 0, k: 0 },
          m: 1,
        },
        {
          ty: 'st',
          c: { a: 0, k: [0.231, 0.51, 0.965, 1] },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 4.5 },
          lc: 2,
          lj: 2,
        },
      ],
      ip: 0,
      op: 60,
      st: 0,
    },
  ],
};

/** JSON vetorial minimalista: círculo e check verde esmeralda #10B981 */
const SUCCESS_JSON: Record<string, unknown> = {
  v: '5.7.4',
  fr: 60,
  ip: 0,
  op: 45,
  w: 72,
  h: 72,
  nm: 'nr-success',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'check',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [36, 36, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [75, 75, 100], e: [104, 104, 100] },
            { t: 22, s: [104, 104, 100], e: [100, 100, 100] },
            { t: 36, s: [100, 100, 100] },
          ],
        },
      },
      shapes: [
        {
          ty: 'el',
          p: { a: 0, k: [0, 0] },
          s: { a: 0, k: [56, 56] },
        },
        {
          ty: 'st',
          c: { a: 0, k: [0.063, 0.725, 0.506, 1] },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 3.5 },
          lc: 2,
          lj: 2,
        },
        {
          ty: 'sh',
          ks: {
            a: 0,
            k: {
              i: [[0, 0], [0, 0], [0, 0]],
              o: [[0, 0], [0, 0], [0, 0]],
              v: [[-11, 1], [-3, 9], [12, -7]],
              c: false,
            },
          },
        },
        {
          ty: 'tm',
          s: { a: 0, k: 0 },
          e: { a: 1, k: [{ t: 6, s: [0], e: [100] }, { t: 34, s: [100] }] },
          o: { a: 0, k: 0 },
          m: 1,
        },
      ],
      ip: 0,
      op: 45,
      st: 0,
    },
  ],
};

/** JSON vetorial discreto: pulso sutil de radar para estados vazios (#94A3B8 / #3B82F6) */
const EMPTY_JSON: Record<string, unknown> = {
  v: '5.7.4',
  fr: 60,
  ip: 0,
  op: 90,
  w: 64,
  h: 64,
  nm: 'nr-empty',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'pulse',
      sr: 1,
      ks: {
        o: { a: 1, k: [{ t: 0, s: [45], e: [90] }, { t: 45, s: [90], e: [45] }, { t: 90, s: [45] }] },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [32, 32, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: [{ t: 0, s: [94, 94, 100], e: [104, 104, 100] }, { t: 45, s: [104, 104, 100], e: [94, 94, 100] }, { t: 90, s: [94, 94, 100] }] },
      },
      shapes: [
        {
          ty: 'rc',
          d: 1,
          s: { a: 0, k: [38, 38] },
          p: { a: 0, k: [0, 0] },
          r: { a: 0, k: 10 },
        },
        {
          ty: 'st',
          c: { a: 0, k: [0.376, 0.647, 0.98, 1] },
          o: { a: 0, k: 85 },
          w: { a: 0, k: 2.2 },
          lc: 2,
          lj: 2,
        },
      ],
      ip: 0,
      op: 90,
      st: 0,
    },
  ],
};

function getPresetData(preset: LottiePreset): { data: Record<string, unknown>; loop: boolean } {
  if (preset === 'loading') return { data: LOADING_JSON, loop: true };
  if (preset === 'success') return { data: SUCCESS_JSON, loop: false };
  return { data: EMPTY_JSON, loop: true };
}

/** Monta uma animação Lottie SVG leve em um container, com limpeza automática de instância anterior. */
export async function mountLottie(container: HTMLElement | null, preset: LottiePreset): Promise<void> {
  if (!container || typeof window === 'undefined' || isReducedMotion()) return;

  const prev = activeInstances.get(container);
  if (prev) {
    prev.destroy();
    activeInstances.delete(container);
  }

  try {
    const mod = await import('lottie-web/build/player/esm/lottie_light.min.js');
    if (!container.isConnected) return;
    container.innerHTML = '';
    const { data, loop } = getPresetData(preset);
    const instance = mod.default.loadAnimation({
      container,
      renderer: 'svg',
      loop,
      autoplay: true,
      animationData: data,
    });
    activeInstances.set(container, instance);
  } catch {
    // Fallback silencioso caso o navegador bloqueie SVG dinâmico
  }
}

/** Hidrata todos os elementos `[data-lottie]` dentro de um escopo DOM. */
export function hydrateLottieElements(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>('[data-lottie]');
  nodes.forEach((node) => {
    const preset = (node.dataset.lottie as LottiePreset | undefined) || 'empty';
    void mountLottie(node, preset);
  });
}

export function destroyLottie(container: HTMLElement | null): void {
  if (!container) return;
  const prev = activeInstances.get(container);
  if (prev) {
    prev.destroy();
    activeInstances.delete(container);
  }
}
