/**
 * Controlador TypeScript da página pública de apresentação (/apresentacao.html)
 * alimentado pelo motor GSAP Studio Motion + Lenis Smooth Scroll — NOVA RUNTIME.
 */

import { animatePresentationPage, getGsap } from '../animations/index.js';
import { initPublicSmoothScroll } from '../animations/smooth-scroll.js';

function initSlotTicker(): void {
  const slots: readonly string[] = ['09:30', '10:30', '14:30', '16:00', '18:15'];
  let idx = 2;
  const clock = document.getElementById('live-slot-clock');
  if (!clock) return;

  window.setInterval(() => {
    idx = (idx + 1) % slots.length;
    const nextSlot = slots[idx] ?? '14:30';
    const gsap = getGsap();
    if (!gsap) {
      clock.textContent = nextSlot;
      return;
    }
    gsap.to(clock, {
      opacity: 0,
      y: -4,
      duration: 0.14,
      ease: 'power2.in',
      onComplete: () => {
        clock.textContent = nextSlot;
        gsap.fromTo(
          clock,
          { opacity: 0, y: 4 },
          { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out', clearProps: 'transform' }
        );
      },
    });
  }, 2600);
}

function initShowcaseTabs(): void {
  const tabs = document.querySelectorAll<HTMLElement>('.showcase-tab');
  const img = document.getElementById('showcase-img') as HTMLImageElement | null;
  const urlLabel = document.getElementById('showcase-url');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('active')) return;
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const nextShot = tab.dataset.shot;
      const nextLabel = tab.dataset.label;
      const altText = `Tela real: ${(tab.textContent || '').trim()}`;
      const gsap = getGsap();

      if (urlLabel && nextLabel) {
        if (gsap) {
          gsap.fromTo(
            urlLabel,
            { opacity: 0.3, y: -2 },
            { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out', clearProps: 'transform' }
          );
        }
        urlLabel.textContent = nextLabel;
      }

      if (img && nextShot) {
        if (!gsap) {
          img.src = nextShot;
          img.alt = altText;
          return;
        }
        gsap.to(img, {
          opacity: 0,
          y: 4,
          duration: 0.14,
          ease: 'power2.in',
          onComplete: () => {
            img.src = nextShot;
            img.alt = altText;
            gsap.fromTo(
              img,
              { opacity: 0, y: 6 },
              { opacity: 1, y: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform' }
            );
          },
        });
      }
    });
  });
}

function bootPresentation(): void {
  initPublicSmoothScroll();
  animatePresentationPage();
  initSlotTicker();
  initShowcaseTabs();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPresentation, { once: true });
} else {
  bootPresentation();
}
