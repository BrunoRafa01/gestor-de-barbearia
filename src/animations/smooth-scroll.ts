/**
 * Rolagem suave com Lenis — EXCLUSIVA para páginas públicas (/agendar, /apresentacao.html).
 * Nunca ativada no painel administrativo para preservar rolagem nativa instantânea em tabelas e grades.
 */

import Lenis from 'lenis';
import { isReducedMotion } from './micro-motion.js';

let activeLenis: Lenis | null = null;
let rafId: number | null = null;

export function initPublicSmoothScroll(onScrollCallback?: () => void): () => void {
  destroyPublicSmoothScroll();

  if (typeof window === 'undefined' || isReducedMotion()) {
    return () => {};
  }

  // Em dispositivos touch puros, a inércia nativa do sistema operacional já é ideal e mais econômica.
  const isTouchPrimary = window.matchMedia('(pointer: coarse)').matches;
  if (isTouchPrimary) {
    return () => {};
  }

  const lenis = new Lenis({
    duration: 0.95,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 0.95,
  });

  if (onScrollCallback) {
    lenis.on('scroll', onScrollCallback);
  }

  const tick = (time: number): void => {
    lenis.raf(time);
    rafId = window.requestAnimationFrame(tick);
  };
  rafId = window.requestAnimationFrame(tick);
  activeLenis = lenis;

  return destroyPublicSmoothScroll;
}

export function destroyPublicSmoothScroll(): void {
  if (rafId !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (activeLenis) {
    activeLenis.destroy();
    activeLenis = null;
  }
}
