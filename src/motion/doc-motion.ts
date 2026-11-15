/**
 * Inicializador TypeScript de animações GSAP para páginas institucionais e LGPD
 * (/compliance.html, /termos.html, /privacidade.html, /cookies.html, /transparencia.html).
 */

import { animateDocumentPage } from './gsap-motion.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => animateDocumentPage(), { once: true });
} else {
  animateDocumentPage();
}
