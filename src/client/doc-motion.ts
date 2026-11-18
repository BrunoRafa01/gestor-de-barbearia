/**
 * Inicializador TypeScript de animações GSAP para páginas institucionais e LGPD
 * (/compliance.html, /termos.html, /privacidade.html, /cookies.html, /transparencia.html) — NOVA RUNTIME.
 */

import { animateDocumentPage, initPublicSmoothScroll } from '../animations/index.js';

function bootDocMotion(): void {
  initPublicSmoothScroll();
  animateDocumentPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootDocMotion, { once: true });
} else {
  bootDocMotion();
}
