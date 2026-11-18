/**
 * Micro-interações físicas com Motion (Vanilla JS API — sem React)
 * Efeitos spring naturais para botões, pílulas de filtro, toggles e dropdowns.
 */

import { animate, spring } from 'motion';

export function isReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Feedback spring natural em botões e pílulas interativas. */
export function springPress(element: HTMLElement | null): void {
  if (!element || isReducedMotion()) return;
  animate(
    element,
    { scale: [0.96, 1.02, 1] },
    { type: spring, stiffness: 520, damping: 24, mass: 0.6 }
  );
}

/** Anima a entrada de um dropdown ou popover com física spring leve. */
export function springPopoverIn(element: HTMLElement | null): void {
  if (!element || isReducedMotion()) return;
  animate(
    element,
    { opacity: [0, 1], y: [-6, 0], scale: [0.97, 1] },
    { type: spring, stiffness: 460, damping: 28, mass: 0.55 }
  );
}

/** Pulso suave de confirmação em indicadores ou chips atualizados. */
export function springHighlight(element: HTMLElement | null): void {
  if (!element || isReducedMotion()) return;
  animate(
    element,
    { scale: [1, 1.045, 1] },
    { type: spring, stiffness: 420, damping: 20, mass: 0.6 }
  );
}

let delegationInstalled = false;
let cleanupDelegation: (() => void) | null = null;

/** Instala delegação global de micro-interações spring para controles do sistema. */
export function initMotionMicroInteractions(): () => void {
  if (typeof document === 'undefined' || isReducedMotion()) {
    return () => {};
  }
  if (delegationInstalled && cleanupDelegation) {
    return cleanupDelegation;
  }

  const INTERACTIVE_SELECTOR =
    '.btn, .ct-seg-btn, .ct-filter-pill, .booksy-cat-pill, .folga-day-btn, .day-chip, .slot-btn';

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    const target = (ev.target as HTMLElement | null)?.closest?.(INTERACTIVE_SELECTOR) as HTMLElement | null;
    if (!target || (target as HTMLButtonElement).disabled) return;
    animate(target, { scale: 0.97 }, { duration: 0.09 });
  };

  const onPointerUpOrCancel = (ev: PointerEvent): void => {
    const target = (ev.target as HTMLElement | null)?.closest?.(INTERACTIVE_SELECTOR) as HTMLElement | null;
    if (!target) return;
    animate(target, { scale: 1 }, { type: spring, stiffness: 500, damping: 26, mass: 0.5 });
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointerup', onPointerUpOrCancel, { passive: true });
  document.addEventListener('pointercancel', onPointerUpOrCancel, { passive: true });

  delegationInstalled = true;
  cleanupDelegation = () => {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointerup', onPointerUpOrCancel);
    document.removeEventListener('pointercancel', onPointerUpOrCancel);
    delegationInstalled = false;
    cleanupDelegation = null;
  };
  return cleanupDelegation;
}
