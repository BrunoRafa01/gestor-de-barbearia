/**
 * GSAP Studio Motion Engine (TypeScript Estrito) — NOVA RUNTIME
 *
 * Motor principal de transições de views, entrada escalonada (stagger), modais,
 * sidebar, contadores numéricos em R$ pt-BR, gráficos SVG, Flip layout e ScrollTrigger.
 * Curvas limpas (power3.out / expo.out), respeito integral a prefers-reduced-motion
 * e limpeza automática de timelines e listeners.
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';
import { initMotionMicroInteractions, isReducedMotion, springPress } from './micro-motion.js';
import { hydrateLottieElements } from './lottie-player.js';

export interface NumberTweenTarget {
  val: number;
}

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const intFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
});

let initialized = false;
let activeViewTimeline: gsap.core.Timeline | null = null;
const cleanupCallbacks: Array<() => void> = [];

export function prefersReducedMotion(): boolean {
  return isReducedMotion();
}

export function getGsap(): typeof gsap | null {
  if (typeof window === 'undefined' || isReducedMotion()) return null;
  return gsap;
}

/** Inicializa plugins do GSAP, micro-interações Motion e spotlight discreto em cards. */
export function initGsapMotion(): void {
  if (typeof window === 'undefined' || isReducedMotion() || initialized) return;
  initialized = true;

  gsap.registerPlugin(ScrollTrigger, Flip);
  gsap.config({ nullTargetWarn: false });
  gsap.defaults({
    ease: 'power3.out',
    duration: 0.28,
    overwrite: 'auto',
  });

  cleanupCallbacks.push(initMotionMicroInteractions());
  cleanupCallbacks.push(setupEditorialHoverDelegation());
}

/** Limpa listeners e timelines globais quando necessário (ex.: desmontagem/testes). */
export function disposeAnimations(): void {
  if (activeViewTimeline) {
    activeViewTimeline.kill();
    activeViewTimeline = null;
  }
  ScrollTrigger.getAll().forEach((st) => st.kill());
  while (cleanupCallbacks.length > 0) {
    const fn = cleanupCallbacks.pop();
    if (fn) fn();
  }
  initialized = false;
}

/** Transição suave de layout usando GSAP Flip para trocas de abas/filtros. */
export function flipLayoutTransition(targetsSelector: string, mutateDom: () => void): void {
  const g = getGsap();
  if (!g || typeof document === 'undefined') {
    mutateDom();
    return;
  }
  const state = Flip.getState(targetsSelector);
  mutateDom();
  Flip.from(state, {
    duration: 0.28,
    ease: 'power3.out',
    stagger: 0.015,
    simple: true,
  });
}

function setupEditorialHoverDelegation(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return () => {};
  }

  const CARD_SELECTOR = '.figma-lookbook-card, .cut-card, .feat-card, .gallery-card';

  const onOver = (ev: PointerEvent): void => {
    const card = (ev.target as HTMLElement | null)?.closest?.(CARD_SELECTOR) as HTMLElement | null;
    if (!card) return;
    const related = ev.relatedTarget as Node | null;
    if (related && card.contains(related)) return;

    gsap.to(card, { y: -2, duration: 0.24, ease: 'power3.out', overwrite: 'auto' });
    const img = card.querySelector('img');
    if (img) {
      gsap.to(img, { scale: 1.025, duration: 0.36, ease: 'power3.out', overwrite: 'auto' });
    }
  };

  const onOut = (ev: PointerEvent): void => {
    const card = (ev.target as HTMLElement | null)?.closest?.(CARD_SELECTOR) as HTMLElement | null;
    if (!card) return;
    const related = ev.relatedTarget as Node | null;
    if (related && card.contains(related)) return;

    gsap.to(card, { y: 0, duration: 0.28, ease: 'power3.out', clearProps: 'transform', overwrite: 'auto' });
    const img = card.querySelector('img');
    if (img) {
      gsap.to(img, { scale: 1, duration: 0.32, ease: 'power3.out', clearProps: 'transform', overwrite: 'auto' });
    }
  };

  document.addEventListener('pointerover', onOver, { passive: true });
  document.addEventListener('pointerout', onOut, { passive: true });
  return () => {
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onOut);
  };
}

export function animateFolgaToggle(btn: HTMLElement | null): void {
  springPress(btn);
}

/* ==========================================================================
   1. ANIMAÇÕES DO PAINEL ADMINISTRATIVO
   ========================================================================== */

export function animateAuthScreen(root: ParentNode = document): void {
  const g = getGsap();
  hydrateLottieElements(root);
  if (!g) return;

  const card = root.querySelector('.auth-card');
  if (!card) return;

  const tl = g.timeline();
  tl.fromTo(
    card,
    { opacity: 0, y: 14, scale: 0.985 },
    { opacity: 1, y: 0, scale: 1, duration: 0.36, ease: 'power3.out', clearProps: 'transform' }
  );

  const children = card.querySelectorAll(
    '.brand, h1, p, .oauth-section, .auth-divider, .field, .btn-primary, .auth-hint'
  );
  if (children.length) {
    tl.fromTo(
      children,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.26, stagger: 0.025, ease: 'power2.out', clearProps: 'transform' },
      '-=0.22'
    );
  }
}

export function animateShellBoot(): void {
  const g = getGsap();
  if (!g) return;

  const tl = g.timeline();
  const sidebar = document.getElementById('sidebar');
  const brand = document.querySelector('#sidebar .brand');
  const navItems = document.querySelectorAll('#sidebar .nav-label, #sidebar .nav-item');
  const sidebarFooter = document.querySelector('#sidebar .sidebar-footer');
  const topbar = document.querySelector('.topbar');
  const topbarItems = document.querySelectorAll('.topbar .topbar-actions > *, .topbar .user-chip');

  if (sidebar) {
    tl.fromTo(
      sidebar,
      { opacity: 0, x: -20 },
      { opacity: 1, x: 0, duration: 0.36, ease: 'expo.out', clearProps: 'transform' },
      0
    );
  }

  if (brand) {
    tl.fromTo(
      brand,
      { opacity: 0, x: -10 },
      { opacity: 1, x: 0, duration: 0.3, ease: 'power3.out', clearProps: 'transform' },
      0.04
    );
  }

  if (navItems.length) {
    tl.fromTo(
      navItems,
      { opacity: 0, x: -12 },
      { opacity: 1, x: 0, duration: 0.28, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' },
      0.08
    );
  }

  if (sidebarFooter) {
    tl.fromTo(
      sidebarFooter,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', clearProps: 'transform' },
      0.2
    );
  }

  if (topbar) {
    tl.fromTo(
      topbar,
      { opacity: 0, y: -12 },
      { opacity: 1, y: 0, duration: 0.32, ease: 'expo.out', clearProps: 'transform' },
      0.04
    );
  }

  if (topbarItems.length) {
    tl.fromTo(
      topbarItems,
      { opacity: 0, y: -6 },
      { opacity: 1, y: 0, duration: 0.26, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' },
      0.12
    );
  }
}

export function animateSidebarMobileOpen(): void {
  const g = getGsap();
  if (!g) return;

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const items = document.querySelectorAll('#sidebar.open .brand, #sidebar.open .nav-label, #sidebar.open .nav-item, #sidebar.open .sidebar-footer');

  if (backdrop) {
    g.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power2.out' });
  }
  if (sidebar) {
    g.fromTo(sidebar, { x: -240 }, { x: 0, duration: 0.34, ease: 'expo.out', clearProps: 'transform' });
  }
  if (items.length) {
    g.fromTo(
      items,
      { opacity: 0, x: -14 },
      { opacity: 1, x: 0, duration: 0.26, stagger: 0.02, delay: 0.06, ease: 'power2.out', clearProps: 'transform' }
    );
  }
}

export function animateNavItemActive(item: HTMLElement | null): void {
  springPress(item);
}

export function animateNumbers(container: ParentNode = document): void {
  const g = getGsap();
  if (!g) return;

  const elements = container.querySelectorAll<HTMLElement>(
    '.kpi-value, .ct-kpi-val, .stat-val, [data-gsap-count]'
  );

  elements.forEach((el) => {
    const raw = (el.textContent || '').trim();
    if (!raw || el.children.length > 0) return;
    const prevRaw = el.dataset.prevNum;
    const startVal =
      prevRaw !== undefined && prevRaw !== '' && Number.isFinite(Number(prevRaw))
        ? Number(prevRaw)
        : 0;

    if (/^-?R\$/.test(raw)) {
      const cleaned = raw.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.');
      const targetVal = Number.parseFloat(cleaned);
      if (!Number.isFinite(targetVal) || targetVal === startVal) return;
      const proxy: NumberTweenTarget = { val: startVal };
      g.to(proxy, {
        val: targetVal,
        duration: 0.6,
        ease: 'power3.out',
        onUpdate: () => {
          el.textContent = brlFormatter.format(proxy.val);
        },
        onComplete: () => {
          el.textContent = raw;
        },
      });
      return;
    }

    if (/^-?\d+(?:[.,]\d+)?%$/.test(raw)) {
      const hasDecimal = raw.includes(',') || raw.includes('.');
      const targetVal = Number.parseFloat(raw.replace('%', '').replace(',', '.'));
      if (!Number.isFinite(targetVal) || targetVal === startVal) return;
      const proxy: NumberTweenTarget = { val: startVal };
      g.to(proxy, {
        val: targetVal,
        duration: 0.55,
        ease: 'power3.out',
        onUpdate: () => {
          el.textContent = hasDecimal
            ? `${proxy.val.toFixed(1).replace('.', ',')}%`
            : `${Math.round(proxy.val)}%`;
        },
        onComplete: () => {
          el.textContent = raw;
        },
      });
      return;
    }

    if (/^\d[\d.]*$/.test(raw)) {
      const targetVal = Number.parseInt(raw.replace(/\./g, ''), 10);
      if (!Number.isFinite(targetVal) || targetVal === startVal) return;
      const proxy: NumberTweenTarget = { val: startVal };
      g.to(proxy, {
        val: targetVal,
        duration: 0.55,
        ease: 'power3.out',
        onUpdate: () => {
          el.textContent = intFormatter.format(Math.round(proxy.val));
        },
        onComplete: () => {
          el.textContent = raw;
        },
      });
    }
  });
}

export function animateChartsAndBars(container: ParentNode = document): void {
  const g = getGsap();
  if (!g) return;

  const bars = container.querySelectorAll<HTMLElement>(
    '.bar-fill, .ct-bar-fill, .quota-bar-fill, .chart-bar-fill'
  );
  if (bars.length) {
    bars.forEach((bar, index) => {
      const targetWidth = bar.style.width;
      if (!targetWidth || targetWidth === '0%') return;
      g.fromTo(
        bar,
        { width: '0%' },
        { width: targetWidth, duration: 0.68, delay: Math.min(index * 0.04, 0.22), ease: 'expo.out' }
      );
    });
  }

  const polylines = container.querySelectorAll<SVGGeometryElement>(
    'svg polyline, svg path.sparkline-path, .ct-spark-row svg path[fill="none"], .fin-chart-line'
  );
  polylines.forEach((line) => {
    try {
      const len = typeof line.getTotalLength === 'function' ? line.getTotalLength() : 0;
      if (len > 0) {
        g.fromTo(
          line,
          { strokeDasharray: len, strokeDashoffset: len },
          { strokeDashoffset: 0, duration: 0.85, ease: 'power2.out' }
        );
      }
    } catch {
      /* elemento SVG sem geometria calculável */
    }
  });

  const sparkAreas = container.querySelectorAll<SVGElement>(
    '.ct-spark-row svg path[fill^="rgba"], .fin-chart-area'
  );
  if (sparkAreas.length) {
    g.fromTo(sparkAreas, { opacity: 0 }, { opacity: 1, duration: 0.5, delay: 0.2, ease: 'power2.out' });
  }
}

export function animatePanelView(container: HTMLElement | null = document.getElementById('content')): void {
  if (!container) return;
  hydrateLottieElements(container);

  const g = getGsap();
  if (!g) return;

  if (activeViewTimeline) {
    activeViewTimeline.kill();
    activeViewTimeline = null;
  }

  const pageTitle = document.getElementById('page-title');
  const pageSub = document.getElementById('page-sub');
  const headerEls = [pageTitle, pageSub].filter(Boolean);
  if (headerEls.length) {
    g.fromTo(
      headerEls,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.26, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' }
    );
  }

  const tl = g.timeline();
  activeViewTimeline = tl;

  const kpis = container.querySelectorAll('.kpi, .ct-kpi-grid > .ct-card');
  if (kpis.length) {
    tl.fromTo(
      kpis,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.32, stagger: 0.035, ease: 'power3.out', clearProps: 'transform' },
      0
    );
  }

  const cards = container.querySelectorAll(
    '.toolbar, .card, .ct-mid-grid > .ct-card, .notice, .grid-2 > *, .grid-3 > *'
  );
  if (cards.length) {
    tl.fromTo(
      cards,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.32, stagger: 0.028, ease: 'power3.out', clearProps: 'transform' },
      kpis.length ? 0.05 : 0
    );
  }

  const folgaBtns = container.querySelectorAll('.folga-day-btn');
  if (folgaBtns.length) {
    tl.fromTo(
      folgaBtns,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.24, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' },
      0.08
    );
  }

  const rows = Array.from(container.querySelectorAll('tbody tr')).slice(0, 25);
  if (rows.length) {
    tl.fromTo(
      rows,
      { opacity: 0, y: 5 },
      { opacity: 1, y: 0, duration: 0.2, stagger: 0.012, ease: 'power2.out', clearProps: 'transform' },
      0.06
    );
  }

  const apptBlocks = container.querySelectorAll('.appt-block, .agenda-event');
  if (apptBlocks.length) {
    tl.fromTo(
      apptBlocks,
      { opacity: 0, y: 5 },
      { opacity: 1, y: 0, duration: 0.24, stagger: 0.018, ease: 'power2.out', clearProps: 'transform' },
      0.06
    );
  }

  const listItems = Array.from(
    container.querySelectorAll('.ct-rank-item, .ct-infra-item, .ct-funnel-row, .list-row, .activity-item')
  ).slice(0, 24);
  if (listItems.length) {
    tl.fromTo(
      listItems,
      { opacity: 0, x: -5 },
      { opacity: 1, x: 0, duration: 0.22, stagger: 0.018, ease: 'power2.out', clearProps: 'transform' },
      0.08
    );
  }

  animateNumbers(container);
  animateChartsAndBars(container);
  ScrollTrigger.refresh();
}

/* ==========================================================================
   2. MODAIS E TOASTS
   ========================================================================== */

export function animateModalOpen(backdrop: HTMLElement, modal: HTMLElement): void {
  hydrateLottieElements(modal);
  const g = getGsap();
  if (!g) return;

  g.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power2.out' });
  g.fromTo(
    modal,
    { opacity: 0, y: 12, scale: 0.98 },
    { opacity: 1, y: 0, scale: 1, duration: 0.24, ease: 'power3.out', clearProps: 'transform' }
  );

  const fields = modal.querySelectorAll('.field, .form-grid > *, .booking-summary > div');
  if (fields.length) {
    g.fromTo(
      fields,
      { opacity: 0, y: 5 },
      { opacity: 1, y: 0, duration: 0.18, stagger: 0.018, delay: 0.03, ease: 'power2.out', clearProps: 'transform' }
    );
  }
}

export function animateModalClose(
  backdrop: HTMLElement,
  modal: HTMLElement | null,
  onDone: () => void
): void {
  const g = getGsap();
  if (!g) {
    onDone();
    return;
  }

  if (modal) {
    g.to(modal, { opacity: 0, y: 8, scale: 0.985, duration: 0.14, ease: 'power2.in' });
  }
  g.to(backdrop, {
    opacity: 0,
    duration: 0.16,
    ease: 'power2.in',
    onComplete: onDone,
  });
}

export function animateToastIn(node: HTMLElement): void {
  const g = getGsap();
  if (!g) return;

  g.fromTo(
    node,
    { opacity: 0, x: 20, y: -4 },
    { opacity: 1, x: 0, y: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform' }
  );

  g.to(node, {
    opacity: 0,
    x: 16,
    duration: 0.2,
    delay: 4.1,
    ease: 'power2.in',
  });
}

/* ==========================================================================
   3. PÁGINA PÚBLICA DE AGENDAMENTO (/agendar)
   ========================================================================== */

export function animateBookingBoot(): void {
  hydrateLottieElements(document);
  const g = getGsap();
  if (!g) return;

  const tl = g.timeline();

  const topNav = document.querySelector('.booking-top-nav');
  if (topNav) {
    tl.fromTo(
      topNav,
      { opacity: 0, y: -8 },
      { opacity: 1, y: 0, duration: 0.26, ease: 'power2.out', clearProps: 'transform' },
      0
    );
  }

  const heroCard = document.querySelector('.figma-hero-card');
  const heroBg = document.querySelector('.figma-hero-bg');
  if (heroCard) {
    tl.fromTo(
      heroCard,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.34, ease: 'power3.out', clearProps: 'transform' },
      0.04
    );
  }
  if (heroBg) {
    tl.fromTo(
      heroBg,
      { scale: 1.04 },
      { scale: 1, duration: 0.9, ease: 'power2.out', clearProps: 'transform' },
      0.04
    );
  }

  const heroItems = document.querySelectorAll(
    '.shop-kicker-row, .shop-profile-name, .shop-profile-meta, .shop-bio-text, .shop-amenity-tag, .shop-action-btn'
  );
  if (heroItems.length) {
    tl.fromTo(
      heroItems,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.26, stagger: 0.022, ease: 'power2.out', clearProps: 'transform' },
      0.1
    );
  }

  const tabs = document.querySelectorAll('.shop-view-tabs .shop-tab-btn, #progress-container');
  if (tabs.length) {
    tl.fromTo(
      tabs,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.22, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' },
      0.16
    );
  }

  animateLookbookCards();
}

export function animateLookbookCards(root: ParentNode = document): void {
  const g = getGsap();
  if (!g) return;

  const cards = root.querySelectorAll('.figma-lookbook-card, .cut-card, .barber-rich-card, .review-item-card');
  if (!cards.length) return;

  g.fromTo(
    cards,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.32, stagger: 0.04, ease: 'power3.out', clearProps: 'transform' }
  );
}

export function animateServicesList(grid: HTMLElement | null): void {
  const g = getGsap();
  if (!g || !grid) return;

  const rows = grid.querySelectorAll('.booksy-service-row');
  if (!rows.length) return;

  g.fromTo(
    rows,
    { opacity: 0, y: 6 },
    { opacity: 1, y: 0, duration: 0.22, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' }
  );
}

export function animateBookingSectionReveal(section: HTMLElement | null): void {
  if (!section) return;
  hydrateLottieElements(section);
  const g = getGsap();
  if (!g) return;

  g.fromTo(
    section,
    { opacity: 0, y: 14 },
    { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out', clearProps: 'transform' }
  );

  const items = section.querySelectorAll('.choice, .day-chip, .field');
  if (items.length) {
    g.fromTo(
      items,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.22, stagger: 0.02, delay: 0.03, ease: 'power2.out', clearProps: 'transform' }
    );
  }
}

export function animateDayStrip(strip: HTMLElement | null): void {
  const g = getGsap();
  if (!g || !strip) return;

  const chips = strip.querySelectorAll('.day-chip');
  if (!chips.length) return;

  g.fromTo(
    chips,
    { opacity: 0, y: 5 },
    { opacity: 1, y: 0, duration: 0.2, stagger: 0.015, ease: 'power2.out', clearProps: 'transform' }
  );
}

export function animateSlotsGrid(area: HTMLElement | null): void {
  if (!area) return;
  hydrateLottieElements(area);
  const g = getGsap();
  if (!g) return;

  const slots = area.querySelectorAll('.slot');
  if (!slots.length) return;

  g.fromTo(
    slots,
    { opacity: 0, y: 5 },
    { opacity: 1, y: 0, duration: 0.2, stagger: 0.01, ease: 'power2.out', clearProps: 'transform' }
  );
}

let lastStickyPriceValue = 0;

export function animateStickyBarPrice(
  targetPrice: number,
  stickyBar: HTMLElement | null,
  priceEl: HTMLElement | null
): void {
  const g = getGsap();
  if (!g) return;

  if (stickyBar && !stickyBar.dataset.gsapShown) {
    stickyBar.dataset.gsapShown = '1';
    g.fromTo(
      stickyBar,
      { y: 36, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.28, ease: 'power3.out', clearProps: 'transform' }
    );
  }

  if (priceEl && Number.isFinite(targetPrice) && targetPrice !== lastStickyPriceValue) {
    const proxy: NumberTweenTarget = { val: lastStickyPriceValue || 0 };
    lastStickyPriceValue = targetPrice;
    g.to(proxy, {
      val: targetPrice,
      duration: 0.34,
      ease: 'power2.out',
      onUpdate: () => {
        priceEl.textContent = brlFormatter.format(proxy.val);
      },
      onComplete: () => {
        priceEl.textContent = brlFormatter.format(targetPrice);
      },
    });
  }
}

export function animateBookingSuccess(container: ParentNode = document): void {
  hydrateLottieElements(container);
  const g = getGsap();
  if (!g) return;

  const box = container.querySelector('.success-box');
  if (!box) return;

  const tl = g.timeline();
  tl.fromTo(
    box,
    { opacity: 0, y: 14 },
    { opacity: 1, y: 0, duration: 0.34, ease: 'power3.out', clearProps: 'transform' }
  );

  const check = box.querySelector('.success-check');
  if (check) {
    tl.fromTo(
      check,
      { scale: 0.85, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.out', clearProps: 'transform' },
      '-=0.2'
    );
  }

  const rows = box.querySelectorAll('h3, p, .booking-summary > div, .btn, .btn-calendar-add');
  if (rows.length) {
    tl.fromTo(
      rows,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.22, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' },
      '-=0.18'
    );
  }
}

/* ==========================================================================
   4. APRESENTAÇÃO & DOCUMENTOS LEGAIS
   ========================================================================== */

export function animatePresentationPage(): void {
  initGsapMotion();
  const g = getGsap();
  if (!g) return;

  const heroTl = g.timeline({ defaults: { ease: 'power3.out' } });
  const nav = document.querySelector('.nav-wrap');
  const pill = document.querySelector('.hero-pill');
  const h1 = document.querySelector('.hero h1');
  const sub = document.querySelector('.hero-sub');
  const ctas = document.querySelector('.hero-ctas');
  const notes = document.querySelector('.hero-notes');

  if (nav) {
    heroTl.fromTo(nav, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3, clearProps: 'transform' }, 0);
  }
  const heroElements = [pill, h1, sub, ctas, notes].filter(Boolean);
  if (heroElements.length) {
    heroTl.fromTo(
      heroElements,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.38, stagger: 0.05, clearProps: 'transform' },
      0.05
    );
  }

  const sections = document.querySelectorAll<HTMLElement>('#telas, #recursos, #estudio, .cta-box');
  sections.forEach((sec) => {
    const head = sec.querySelector('.section-head');
    if (head) {
      g.fromTo(
        head,
        { opacity: 0, y: 14 },
        {
          opacity: 1,
          y: 0,
          duration: 0.36,
          ease: 'power3.out',
          clearProps: 'transform',
          scrollTrigger: { trigger: sec, start: 'top 84%' },
        }
      );
    }
  });

  const showcaseFrame = document.querySelector('.showcase-frame');
  if (showcaseFrame) {
    g.fromTo(
      showcaseFrame,
      { opacity: 0, y: 18 },
      {
        opacity: 1,
        y: 0,
        duration: 0.44,
        ease: 'power3.out',
        clearProps: 'transform',
        scrollTrigger: { trigger: showcaseFrame, start: 'top 86%' },
      }
    );
  }

  const featCards = document.querySelectorAll('.feat-card');
  if (featCards.length) {
    g.fromTo(
      featCards,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.34,
        stagger: 0.045,
        ease: 'power3.out',
        clearProps: 'transform',
        scrollTrigger: { trigger: '.feat-grid', start: 'top 85%' },
      }
    );
  }

  const galleryCards = document.querySelectorAll('.gallery-card');
  if (galleryCards.length) {
    g.fromTo(
      galleryCards,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.36,
        stagger: 0.06,
        ease: 'power3.out',
        clearProps: 'transform',
        scrollTrigger: { trigger: '.gallery-grid', start: 'top 86%' },
      }
    );
  }
}

export function animateDocumentPage(): void {
  initGsapMotion();
  const g = getGsap();
  if (!g) return;

  const blocks = document.querySelectorAll(
    'header, main h1, main h2, main section, .card, .legal-card, .dsr-card, article'
  );
  if (!blocks.length) return;

  g.fromTo(
    Array.from(blocks).slice(0, 18),
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.28, stagger: 0.022, ease: 'power2.out', clearProps: 'transform' }
  );
}
