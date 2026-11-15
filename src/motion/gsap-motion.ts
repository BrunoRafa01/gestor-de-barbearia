/**
 * GSAP Studio Motion Engine (TypeScript) — Gestor de Barbearia (Nova Runtime)
 *
 * Sistema unificado de animações em 60fps com precisão editorial (estilo Linear / Stripe / Apple):
 * curvas exponenciais limpas (expo.out / power3.out), sem 3D exagerado ou saltos artificiais,
 * cobrindo / (Painel Admin), /agendar (Reserva Pública), /apresentacao.html e páginas LGPD.
 */

import type { gsap as GsapInstance } from 'gsap';

export interface FlipState {
  targets: Element[];
}

export interface FlipPluginLike {
  getState(targets: string | Element | Element[] | NodeListOf<Element>): FlipState;
  from(
    state: FlipState,
    vars?: {
      duration?: number;
      ease?: string;
      stagger?: number;
      absolute?: boolean;
      nested?: boolean;
      simple?: boolean;
    }
  ): unknown;
}

declare global {
  interface Window {
    gsap?: typeof GsapInstance;
    ScrollTrigger?: unknown;
    Flip?: FlipPluginLike;
    __gbGsapInitialized?: boolean;
  }
}

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

/** Verifica se o usuário prefere movimento reduzido no sistema operacional. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Retorna a instância global do GSAP caso carregada e permitida. */
export function getGsap(): typeof GsapInstance | null {
  if (typeof window === 'undefined' || !window.gsap) return null;
  if (prefersReducedMotion()) return null;
  return window.gsap;
}

/** Inicializa plugins do GSAP, defaults editoriais e delegação de micro-interações táteis. */
export function initGsapMotion(): void {
  const gsap = getGsap();
  if (!gsap || typeof window === 'undefined') return;
  if (window.__gbGsapInitialized) return;
  window.__gbGsapInitialized = true;

  if (window.ScrollTrigger) {
    gsap.registerPlugin(window.ScrollTrigger as object);
  }
  if (window.Flip) {
    gsap.registerPlugin(window.Flip as object);
  }

  gsap.config({ nullTargetWarn: false });
  gsap.defaults({
    ease: 'power3.out',
    duration: 0.32,
    overwrite: 'auto',
  });

  setupTactilePressDelegation(gsap);
  setupEditorialHoverDelegation(gsap);
}

/** Resposta física discreta e precisa ao clique/toque (sem rebote elástico exagerado). */
function setupTactilePressDelegation(gsap: typeof GsapInstance): void {
  const SELECTOR =
    '.btn, .choice, .day-chip, .slot, .nav-item, .shop-tab-btn, .booksy-cat-pill, .figma-lookbook-card, .icon-btn, .shop-action-btn, .showcase-tab, .cta-main, .cta-sec, .btn-primary-nav, .btn-ghost';

  document.addEventListener(
    'pointerdown',
    (ev: PointerEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null;
      if (!target || (target as HTMLButtonElement).disabled) return;
      gsap.to(target, {
        scale: 0.98,
        duration: 0.1,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    },
    { passive: true }
  );

  const release = (ev: PointerEvent) => {
    const target = (ev.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null;
    if (!target) return;
    gsap.to(target, {
      scale: 1,
      duration: 0.22,
      ease: 'power3.out',
      clearProps: 'scale',
      overwrite: 'auto',
    });
  };

  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  document.addEventListener('pointerout', (ev: PointerEvent) => {
    const target = (ev.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null;
    if (!target) return;
    const related = ev.relatedTarget as Node | null;
    if (related && target.contains(related)) return;
    gsap.to(target, {
      scale: 1,
      duration: 0.2,
      ease: 'power2.out',
      clearProps: 'scale',
      overwrite: 'auto',
    });
  });
}

/** Elevação plana de estúdio em cards de foto e recursos no desktop (sem inclinação 3D artificial). */
function setupEditorialHoverDelegation(gsap: typeof GsapInstance): void {
  if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return;
  }

  const CARD_SELECTOR = '.figma-lookbook-card, .cut-card, .feat-card, .gallery-card';

  document.addEventListener('pointerover', (ev: PointerEvent) => {
    const card = (ev.target as HTMLElement | null)?.closest?.(CARD_SELECTOR) as HTMLElement | null;
    if (!card) return;
    const related = ev.relatedTarget as Node | null;
    if (related && card.contains(related)) return;

    gsap.to(card, {
      y: -3,
      duration: 0.28,
      ease: 'power3.out',
      overwrite: 'auto',
    });

    const img = card.querySelector('img');
    if (img) {
      gsap.to(img, {
        scale: 1.03,
        duration: 0.42,
        ease: 'power3.out',
        overwrite: 'auto',
      });
    }
  });

  document.addEventListener('pointerout', (ev: PointerEvent) => {
    const card = (ev.target as HTMLElement | null)?.closest?.(CARD_SELECTOR) as HTMLElement | null;
    if (!card) return;
    const related = ev.relatedTarget as Node | null;
    if (related && card.contains(related)) return;

    gsap.to(card, {
      y: 0,
      duration: 0.32,
      ease: 'power3.out',
      clearProps: 'transform',
      overwrite: 'auto',
    });

    const img = card.querySelector('img');
    if (img) {
      gsap.to(img, {
        scale: 1,
        duration: 0.38,
        ease: 'power3.out',
        clearProps: 'transform',
        overwrite: 'auto',
      });
    }
  });
}

/* ==========================================================================
   1. ANIMAÇÕES DO PAINEL ADMINISTRATIVO (/ e /painel)
   ========================================================================== */

/** Anima a entrada do card de Login / Troca de senha com precisão editorial. */
export function animateAuthScreen(root: ParentNode = document): void {
  const gsap = getGsap();
  if (!gsap) return;

  const card = root.querySelector('.auth-card');
  if (!card) return;

  const tl = gsap.timeline();
  tl.fromTo(
    card,
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.38, ease: 'power3.out', clearProps: 'transform' }
  );

  const children = card.querySelectorAll(
    '.brand-mark, h1, .auth-sub, .btn-oauth, .auth-divider, .field, button[type="submit"], .auth-hint'
  );
  if (children.length) {
    tl.fromTo(
      children,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.28, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' },
      '-=0.24'
    );
  }
}

/** Anima o carregamento estrutural do Shell (Sidebar + Topbar). */
export function animateShellBoot(): void {
  const gsap = getGsap();
  if (!gsap) return;

  const tl = gsap.timeline();
  const brand = document.querySelector('#sidebar .brand');
  const navItems = document.querySelectorAll('#sidebar .nav-label, #sidebar .nav-item');
  const topbar = document.querySelector('.topbar');

  if (brand) {
    tl.fromTo(brand, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.28, clearProps: 'transform' });
  }
  if (navItems.length) {
    tl.fromTo(
      navItems,
      { opacity: 0, x: -8 },
      { opacity: 1, x: 0, duration: 0.24, stagger: 0.018, ease: 'power2.out', clearProps: 'transform' },
      '-=0.18'
    );
  }
  if (topbar) {
    tl.fromTo(
      topbar,
      { opacity: 0, y: -6 },
      { opacity: 1, y: 0, duration: 0.26, ease: 'power2.out', clearProps: 'transform' },
      '-=0.2'
    );
  }
}

/** Anima a abertura do menu lateral no mobile. */
export function animateSidebarMobileOpen(): void {
  const gsap = getGsap();
  if (!gsap) return;
  const items = document.querySelectorAll('#sidebar.open .nav-item, #sidebar.open .nav-label');
  if (items.length) {
    gsap.fromTo(
      items,
      { opacity: 0, x: -12 },
      { opacity: 1, x: 0, duration: 0.24, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' }
    );
  }
}

/** Anima contadores numéricos, moedas (R$) e porcentagens dentro de um container. */
export function animateNumbers(container: ParentNode = document): void {
  const gsap = getGsap();
  if (!gsap) return;

  const elements = container.querySelectorAll<HTMLElement>(
    '.kpi-value, .stat-val, [data-gsap-count]'
  );

  elements.forEach((el) => {
    const raw = (el.textContent || '').trim();
    if (!raw || el.children.length > 0) return;

    if (raw.startsWith('R$')) {
      const cleaned = raw.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.');
      const targetVal = Number.parseFloat(cleaned);
      if (!Number.isFinite(targetVal) || targetVal === 0) return;
      const proxy: NumberTweenTarget = { val: 0 };
      gsap.to(proxy, {
        val: targetVal,
        duration: 0.7,
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

    if (/^\d+(?:[.,]\d+)?%$/.test(raw)) {
      const hasDecimal = raw.includes(',') || raw.includes('.');
      const targetVal = Number.parseFloat(raw.replace('%', '').replace(',', '.'));
      if (!Number.isFinite(targetVal) || targetVal === 0) return;
      const proxy: NumberTweenTarget = { val: 0 };
      gsap.to(proxy, {
        val: targetVal,
        duration: 0.65,
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
      if (!Number.isFinite(targetVal) || targetVal === 0) return;
      const proxy: NumberTweenTarget = { val: 0 };
      gsap.to(proxy, {
        val: targetVal,
        duration: 0.65,
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

/** Anima barras de progresso, gráficos horizontais e sparklines SVG. */
export function animateChartsAndBars(container: ParentNode = document): void {
  const gsap = getGsap();
  if (!gsap) return;

  const bars = container.querySelectorAll<HTMLElement>('.bar-fill, .quota-bar-fill, .chart-bar-fill');
  if (bars.length) {
    bars.forEach((bar) => {
      const targetWidth = bar.style.width;
      if (!targetWidth || targetWidth === '0%') return;
      gsap.fromTo(
        bar,
        { width: '0%' },
        { width: targetWidth, duration: 0.72, ease: 'power3.out' }
      );
    });
  }

  const polylines = container.querySelectorAll<SVGGeometryElement>('svg polyline, svg path.sparkline-path');
  polylines.forEach((line) => {
    try {
      const len = typeof line.getTotalLength === 'function' ? line.getTotalLength() : 0;
      if (len > 0) {
        gsap.fromTo(
          line,
          { strokeDasharray: len, strokeDashoffset: len },
          { strokeDashoffset: 0, duration: 0.85, ease: 'power2.out' }
        );
      }
    } catch {
      /* elemento SVG sem geometria calculável */
    }
  });
}

/** Anima a transição completa de qualquer View do Painel (#content). */
export function animatePanelView(container: HTMLElement | null = document.getElementById('content')): void {
  const gsap = getGsap();
  if (!gsap || !container) return;

  const pageTitle = document.getElementById('page-title');
  const pageSub = document.getElementById('page-sub');
  if (pageTitle) {
    gsap.fromTo(
      [pageTitle, pageSub].filter(Boolean),
      { opacity: 0, y: 4 },
      { opacity: 1, y: 0, duration: 0.22, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' }
    );
  }

  const tl = gsap.timeline();

  const kpis = container.querySelectorAll('.kpi');
  if (kpis.length) {
    tl.fromTo(
      kpis,
      { opacity: 0, y: 12 },
      {
        opacity: 1,
        y: 0,
        duration: 0.3,
        stagger: 0.032,
        ease: 'power3.out',
        clearProps: 'transform',
      },
      0
    );
  }

  const cards = container.querySelectorAll('.toolbar, .card, .notice, .grid-2 > *, .grid-3 > *');
  if (cards.length) {
    tl.fromTo(
      cards,
      { opacity: 0, y: 12 },
      {
        opacity: 1,
        y: 0,
        duration: 0.32,
        stagger: 0.028,
        ease: 'power3.out',
        clearProps: 'transform',
      },
      kpis.length ? 0.06 : 0
    );
  }

  const rows = Array.from(container.querySelectorAll('tbody tr')).slice(0, 25);
  if (rows.length) {
    tl.fromTo(
      rows,
      { opacity: 0, y: 6 },
      {
        opacity: 1,
        y: 0,
        duration: 0.22,
        stagger: 0.014,
        ease: 'power2.out',
        clearProps: 'transform',
      },
      0.08
    );
  }

  const apptBlocks = container.querySelectorAll('.appt-block, .agenda-event');
  if (apptBlocks.length) {
    tl.fromTo(
      apptBlocks,
      { opacity: 0, y: 6 },
      {
        opacity: 1,
        y: 0,
        duration: 0.26,
        stagger: 0.02,
        ease: 'power2.out',
        clearProps: 'transform',
      },
      0.08
    );
  }

  animateNumbers(container);
  animateChartsAndBars(container);
}

/* ==========================================================================
   2. MODAIS E TOASTS (public/js/ui.js)
   ========================================================================== */

/** Anima a abertura de um modal de forma limpa e direta. */
export function animateModalOpen(backdrop: HTMLElement, modal: HTMLElement): void {
  const gsap = getGsap();
  if (!gsap) return;

  gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power2.out' });
  gsap.fromTo(
    modal,
    { opacity: 0, y: 14, scale: 0.98 },
    { opacity: 1, y: 0, scale: 1, duration: 0.26, ease: 'power3.out', clearProps: 'transform' }
  );

  const fields = modal.querySelectorAll('.field, .form-grid > *, .booking-summary > div');
  if (fields.length) {
    gsap.fromTo(
      fields,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.2, stagger: 0.02, delay: 0.04, ease: 'power2.out', clearProps: 'transform' }
    );
  }
}

/** Anima o fechamento suave do modal antes de remover do DOM. */
export function animateModalClose(
  backdrop: HTMLElement,
  modal: HTMLElement | null,
  onDone: () => void
): void {
  const gsap = getGsap();
  if (!gsap) {
    onDone();
    return;
  }

  if (modal) {
    gsap.to(modal, { opacity: 0, y: 8, scale: 0.985, duration: 0.14, ease: 'power2.in' });
  }
  gsap.to(backdrop, {
    opacity: 0,
    duration: 0.16,
    ease: 'power2.in',
    onComplete: onDone,
  });
}

/** Anima a entrada e saída de uma notificação Toast sem saltos exagerados. */
export function animateToastIn(node: HTMLElement): void {
  const gsap = getGsap();
  if (!gsap) return;

  gsap.fromTo(
    node,
    { opacity: 0, x: 24, y: -4 },
    { opacity: 1, x: 0, y: 0, duration: 0.28, ease: 'power3.out', clearProps: 'transform' }
  );

  gsap.to(node, {
    opacity: 0,
    x: 18,
    duration: 0.22,
    delay: 4.1,
    ease: 'power2.in',
  });
}

/* ==========================================================================
   3. ANIMAÇÕES DA PÁGINA PÚBLICA DE AGENDAMENTO (/agendar)
   ========================================================================== */

/** Timeline editorial de entrada da página /agendar. */
export function animateBookingBoot(): void {
  const gsap = getGsap();
  if (!gsap) return;

  const tl = gsap.timeline();

  const topNav = document.querySelector('.booking-top-nav');
  if (topNav) {
    tl.fromTo(
      topNav,
      { opacity: 0, y: -8 },
      { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', clearProps: 'transform' },
      0
    );
  }

  const heroCard = document.querySelector('.figma-hero-card');
  const heroBg = document.querySelector('.figma-hero-bg');
  if (heroCard) {
    tl.fromTo(
      heroCard,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.38, ease: 'power3.out', clearProps: 'transform' },
      0.04
    );
  }
  if (heroBg) {
    tl.fromTo(
      heroBg,
      { scale: 1.05 },
      { scale: 1, duration: 1.0, ease: 'power2.out', clearProps: 'transform' },
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
      { opacity: 1, y: 0, duration: 0.28, stagger: 0.025, ease: 'power2.out', clearProps: 'transform' },
      0.12
    );
  }

  const tabs = document.querySelectorAll('.shop-view-tabs .shop-tab-btn, #progress-container');
  if (tabs.length) {
    tl.fromTo(
      tabs,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.24, stagger: 0.022, ease: 'power2.out', clearProps: 'transform' },
      0.18
    );
  }

  animateLookbookCards();
}

/** Anima os cards 4:5 do Lookbook e da aba Portfólio / Equipe / Avaliações. */
export function animateLookbookCards(root: ParentNode = document): void {
  const gsap = getGsap();
  if (!gsap) return;

  const cards = root.querySelectorAll('.figma-lookbook-card, .cut-card, .barber-rich-card, .review-item-card');
  if (!cards.length) return;

  gsap.fromTo(
    cards,
    { opacity: 0, y: 14 },
    {
      opacity: 1,
      y: 0,
      duration: 0.34,
      stagger: 0.045,
      ease: 'power3.out',
      clearProps: 'transform',
    }
  );
}

/** Anima a lista de serviços ao filtrar por categoria ou carregar. */
export function animateServicesList(grid: HTMLElement | null): void {
  const gsap = getGsap();
  if (!gsap || !grid) return;

  const rows = grid.querySelectorAll('.booksy-service-row');
  if (!rows.length) return;

  gsap.fromTo(
    rows,
    { opacity: 0, y: 8 },
    {
      opacity: 1,
      y: 0,
      duration: 0.24,
      stagger: 0.024,
      ease: 'power2.out',
      clearProps: 'transform',
    }
  );
}

/** Anima a revelação progressiva de uma etapa (#sec-barber, #sec-date, #sec-form). */
export function animateBookingSectionReveal(section: HTMLElement | null): void {
  const gsap = getGsap();
  if (!gsap || !section) return;

  gsap.fromTo(
    section,
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.34, ease: 'power3.out', clearProps: 'transform' }
  );

  const items = section.querySelectorAll('.choice, .day-chip, .field');
  if (items.length) {
    gsap.fromTo(
      items,
      { opacity: 0, y: 8 },
      {
        opacity: 1,
        y: 0,
        duration: 0.24,
        stagger: 0.025,
        delay: 0.04,
        ease: 'power2.out',
        clearProps: 'transform',
      }
    );
  }
}

/** Anima os chips de dias disponíveis (#day-strip). */
export function animateDayStrip(strip: HTMLElement | null): void {
  const gsap = getGsap();
  if (!gsap || !strip) return;

  const chips = strip.querySelectorAll('.day-chip');
  if (!chips.length) return;

  gsap.fromTo(
    chips,
    { opacity: 0, y: 6 },
    {
      opacity: 1,
      y: 0,
      duration: 0.22,
      stagger: 0.018,
      ease: 'power2.out',
      clearProps: 'transform',
    }
  );
}

/** Anima a grade de horários livres (#slot-area). */
export function animateSlotsGrid(area: HTMLElement | null): void {
  const gsap = getGsap();
  if (!gsap || !area) return;

  const slots = area.querySelectorAll('.slot');
  if (!slots.length) return;

  gsap.fromTo(
    slots,
    { opacity: 0, y: 6 },
    {
      opacity: 1,
      y: 0,
      duration: 0.22,
      stagger: 0.012,
      ease: 'power2.out',
      clearProps: 'transform',
    }
  );
}

let lastStickyPriceValue = 0;

/** Anima a barra inferior sticky e faz transição suave do valor selecionado. */
export function animateStickyBarPrice(
  targetPrice: number,
  stickyBar: HTMLElement | null,
  priceEl: HTMLElement | null
): void {
  const gsap = getGsap();
  if (!gsap) return;

  if (stickyBar && !stickyBar.dataset.gsapShown) {
    stickyBar.dataset.gsapShown = '1';
    gsap.fromTo(
      stickyBar,
      { y: 40, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.3, ease: 'power3.out', clearProps: 'transform' }
    );
  }

  if (priceEl && Number.isFinite(targetPrice) && targetPrice !== lastStickyPriceValue) {
    const proxy: NumberTweenTarget = { val: lastStickyPriceValue || 0 };
    lastStickyPriceValue = targetPrice;
    gsap.to(proxy, {
      val: targetPrice,
      duration: 0.38,
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

/** Anima a tela de confirmação de agendamento concluído de forma sóbria e elegante. */
export function animateBookingSuccess(container: ParentNode = document): void {
  const gsap = getGsap();
  if (!gsap) return;

  const box = container.querySelector('.success-box');
  if (!box) return;

  const tl = gsap.timeline();
  tl.fromTo(
    box,
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.36, ease: 'power3.out', clearProps: 'transform' }
  );

  const check = box.querySelector('.success-check');
  if (check) {
    tl.fromTo(
      check,
      { scale: 0.8, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.32, ease: 'power3.out', clearProps: 'transform' },
      '-=0.22'
    );
  }

  const rows = box.querySelectorAll('h3, p, .booking-summary > div, .btn, .btn-calendar-add');
  if (rows.length) {
    tl.fromTo(
      rows,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.24, stagger: 0.025, ease: 'power2.out', clearProps: 'transform' },
      '-=0.22'
    );
  }
}

/* ==========================================================================
   4. ANIMAÇÕES DA PÁGINA DE APRESENTAÇÃO (/apresentacao.html) & DOCUMENTOS LGPD
   ========================================================================== */

/** Anima a página de apresentação (/apresentacao.html) com ScrollTrigger e transições editoriais. */
export function animatePresentationPage(): void {
  initGsapMotion();
  const gsap = getGsap();
  if (!gsap) return;

  // 1. Entrada limpa do Hero
  const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  const nav = document.querySelector('.nav-wrap');
  const pill = document.querySelector('.hero-pill');
  const h1 = document.querySelector('.hero h1');
  const sub = document.querySelector('.hero-sub');
  const ctas = document.querySelector('.hero-ctas');
  const notes = document.querySelector('.hero-notes');

  if (nav) {
    heroTl.fromTo(nav, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.32, clearProps: 'transform' }, 0);
  }
  const heroElements = [pill, h1, sub, ctas, notes].filter(Boolean);
  if (heroElements.length) {
    heroTl.fromTo(
      heroElements,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.42, stagger: 0.06, clearProps: 'transform' },
      0.06
    );
  }

  // 2. Seções reveladas ao rolar (ScrollTrigger)
  if (window.ScrollTrigger) {
    const sections = document.querySelectorAll<HTMLElement>('#telas, #recursos, #estudio, .cta-box');
    sections.forEach((sec) => {
      const head = sec.querySelector('.section-head');
      if (head) {
        gsap.fromTo(
          head,
          { opacity: 0, y: 16 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: 'power3.out',
            clearProps: 'transform',
            scrollTrigger: {
              trigger: sec,
              start: 'top 84%',
            },
          }
        );
      }
    });

    const showcaseFrame = document.querySelector('.showcase-frame');
    if (showcaseFrame) {
      gsap.fromTo(
        showcaseFrame,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.48,
          ease: 'power3.out',
          clearProps: 'transform',
          scrollTrigger: {
            trigger: showcaseFrame,
            start: 'top 86%',
          },
        }
      );
    }

    const featCards = document.querySelectorAll('.feat-card');
    if (featCards.length) {
      gsap.fromTo(
        featCards,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.38,
          stagger: 0.055,
          ease: 'power3.out',
          clearProps: 'transform',
          scrollTrigger: {
            trigger: '.feat-grid',
            start: 'top 85%',
          },
        }
      );
    }

    const galleryCards = document.querySelectorAll('.gallery-card');
    if (galleryCards.length) {
      gsap.fromTo(
        galleryCards,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.08,
          ease: 'power3.out',
          clearProps: 'transform',
          scrollTrigger: {
            trigger: '.gallery-grid',
            start: 'top 86%',
          },
        }
      );
    }

    const ctaBox = document.querySelector('.cta-box');
    if (ctaBox) {
      gsap.fromTo(
        ctaBox,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.42,
          ease: 'power3.out',
          clearProps: 'transform',
          scrollTrigger: {
            trigger: ctaBox,
            start: 'top 88%',
          },
        }
      );
    }
  }
}

/** Anima páginas institucionais e legais (Compliance, Termos, Privacidade, Cookies, Transparência). */
export function animateDocumentPage(): void {
  initGsapMotion();
  const gsap = getGsap();
  if (!gsap) return;

  const blocks = document.querySelectorAll(
    'header, main h1, main h2, main section, .card, .legal-card, .dsr-card, article'
  );
  if (!blocks.length) return;

  gsap.fromTo(
    Array.from(blocks).slice(0, 18),
    { opacity: 0, y: 10 },
    {
      opacity: 1,
      y: 0,
      duration: 0.3,
      stagger: 0.025,
      ease: 'power2.out',
      clearProps: 'transform',
    }
  );
}
