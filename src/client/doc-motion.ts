/**
 * Inicializador leve (sem GSAP/Lenis) para páginas institucionais e LGPD
 * (/compliance.html, /termos.html, /privacidade.html, /cookies.html, /transparencia.html).
 */

function bootDocMotion(): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const sections = document.querySelectorAll<HTMLElement>('.legal-section, .req-card');
  if (!sections.length || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        observer.unobserve(el);
      }
    },
    { threshold: 0.08 }
  );

  sections.forEach((el) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = 'opacity 240ms ease, transform 240ms ease';
    observer.observe(el);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootDocMotion, { once: true });
} else {
  bootDocMotion();
}
