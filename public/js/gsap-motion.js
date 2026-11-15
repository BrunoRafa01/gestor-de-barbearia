/**
 * GSAP Studio Motion Engine (TypeScript) — Gestor de Barbearia (Nova Runtime)
 *
 * Sistema centralizado de animações e micro-interações em 60fps alimentado por GSAP,
 * cobrindo tanto a página pública de agendamento (/agendar) quanto todo o Painel SaaS (/painel).
 */
const brlFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
});
const intFormatter = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
});
/** Verifica se o usuário prefere movimento reduzido no sistema operacional. */
export function prefersReducedMotion() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
        return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Retorna a instância global do GSAP caso carregada e permitida. */
export function getGsap() {
    if (typeof window === 'undefined' || !window.gsap)
        return null;
    if (prefersReducedMotion())
        return null;
    return window.gsap;
}
/** Inicializa plugins do GSAP, defaults de física e delegação de micro-interações táteis. */
export function initGsapMotion() {
    const gsap = getGsap();
    if (!gsap || typeof window === 'undefined')
        return;
    if (window.__gbGsapInitialized)
        return;
    window.__gbGsapInitialized = true;
    if (window.ScrollTrigger) {
        gsap.registerPlugin(window.ScrollTrigger);
    }
    if (window.Flip) {
        gsap.registerPlugin(window.Flip);
    }
    gsap.config({ nullTargetWarn: false });
    gsap.defaults({
        ease: 'power3.out',
        duration: 0.36,
        overwrite: 'auto',
    });
    setupTactilePressDelegation(gsap);
    setupMagneticCardsDelegation(gsap);
}
/** Micro-interação física (mola suave) em botões, chips, abas e cards clicáveis. */
function setupTactilePressDelegation(gsap) {
    const SELECTOR = '.btn, .choice, .day-chip, .slot, .nav-item, .shop-tab-btn, .booksy-cat-pill, .figma-lookbook-card, .icon-btn, .shop-action-btn';
    document.addEventListener('pointerdown', (ev) => {
        const target = ev.target?.closest?.(SELECTOR);
        if (!target || target.disabled)
            return;
        gsap.to(target, {
            scale: 0.965,
            duration: 0.12,
            ease: 'power2.out',
            overwrite: 'auto',
        });
    }, { passive: true });
    const release = (ev) => {
        const target = ev.target?.closest?.(SELECTOR);
        if (!target)
            return;
        gsap.to(target, {
            scale: 1,
            duration: 0.34,
            ease: 'back.out(2.2)',
            clearProps: 'scale',
            overwrite: 'auto',
        });
    };
    document.addEventListener('pointerup', release, { passive: true });
    document.addEventListener('pointercancel', release, { passive: true });
    document.addEventListener('pointerout', (ev) => {
        const target = ev.target?.closest?.(SELECTOR);
        if (!target)
            return;
        const related = ev.relatedTarget;
        if (related && target.contains(related))
            return;
        gsap.to(target, {
            scale: 1,
            duration: 0.25,
            ease: 'power2.out',
            clearProps: 'scale',
            overwrite: 'auto',
        });
    });
}
/** Efeito sutil de inclinação 3D / zoom na foto em cards de lookbook e portfólio no desktop. */
function setupMagneticCardsDelegation(gsap) {
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        return;
    }
    document.addEventListener('pointermove', (ev) => {
        const card = ev.target?.closest?.('.figma-lookbook-card, .cut-card');
        if (!card)
            return;
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height)
            return;
        const relX = (ev.clientX - rect.left) / rect.width - 0.5;
        const relY = (ev.clientY - rect.top) / rect.height - 0.5;
        gsap.to(card, {
            rotateY: relX * 6,
            rotateX: -relY * 6,
            y: -3,
            transformPerspective: 700,
            duration: 0.28,
            ease: 'power2.out',
            overwrite: 'auto',
        });
        const img = card.querySelector('img');
        if (img) {
            gsap.to(img, {
                scale: 1.05,
                x: -relX * 6,
                y: -relY * 6,
                duration: 0.38,
                ease: 'power2.out',
                overwrite: 'auto',
            });
        }
    });
    document.addEventListener('pointerout', (ev) => {
        const card = ev.target?.closest?.('.figma-lookbook-card, .cut-card');
        if (!card)
            return;
        const related = ev.relatedTarget;
        if (related && card.contains(related))
            return;
        gsap.to(card, {
            rotateY: 0,
            rotateX: 0,
            y: 0,
            duration: 0.45,
            ease: 'power3.out',
            clearProps: 'transform',
            overwrite: 'auto',
        });
        const img = card.querySelector('img');
        if (img) {
            gsap.to(img, {
                scale: 1,
                x: 0,
                y: 0,
                duration: 0.45,
                ease: 'power3.out',
                clearProps: 'transform',
                overwrite: 'auto',
            });
        }
    });
}
/* ==========================================================================
   ANIMAÇÕES DO PAINEL ADMINISTRATIVO E SAAS (/ e /painel)
   ========================================================================== */
/** Anima a entrada do card de Login / Troca de senha. */
export function animateAuthScreen(root = document) {
    const gsap = getGsap();
    if (!gsap)
        return;
    const card = root.querySelector('.auth-card');
    if (!card)
        return;
    const tl = gsap.timeline();
    tl.fromTo(card, { opacity: 0, y: 26, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.48, ease: 'power3.out', clearProps: 'transform' });
    const brandMark = card.querySelector('.brand-mark');
    if (brandMark) {
        tl.fromTo(brandMark, { scale: 0.65, rotate: -14, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.42, ease: 'back.out(2.2)', clearProps: 'transform' }, '-=0.32');
    }
    const children = card.querySelectorAll('h1, .auth-sub, .btn-oauth, .auth-divider, .field, button[type="submit"], .auth-hint');
    if (children.length) {
        tl.fromTo(children, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.045, ease: 'power2.out', clearProps: 'transform' }, '-=0.28');
    }
}
/** Anima o carregamento estrutural do Shell (Sidebar + Topbar). */
export function animateShellBoot() {
    const gsap = getGsap();
    if (!gsap)
        return;
    const tl = gsap.timeline();
    const brand = document.querySelector('#sidebar .brand');
    const navItems = document.querySelectorAll('#sidebar .nav-label, #sidebar .nav-item');
    const topbar = document.querySelector('.topbar');
    if (brand) {
        tl.fromTo(brand, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.34, clearProps: 'transform' });
    }
    if (navItems.length) {
        tl.fromTo(navItems, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.28, stagger: 0.022, ease: 'power2.out', clearProps: 'transform' }, '-=0.22');
    }
    if (topbar) {
        tl.fromTo(topbar, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out', clearProps: 'transform' }, '-=0.26');
    }
}
/** Anima a abertura do menu lateral no mobile. */
export function animateSidebarMobileOpen() {
    const gsap = getGsap();
    if (!gsap)
        return;
    const items = document.querySelectorAll('#sidebar.open .nav-item, #sidebar.open .nav-label');
    if (items.length) {
        gsap.fromTo(items, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.28, stagger: 0.025, ease: 'power2.out', clearProps: 'transform' });
    }
}
/** Anima contadores numéricos, moedas (R$) e porcentagens dentro de um container. */
export function animateNumbers(container = document) {
    const gsap = getGsap();
    if (!gsap)
        return;
    const elements = container.querySelectorAll('.kpi-value, .stat-val, [data-gsap-count]');
    elements.forEach((el) => {
        const raw = (el.textContent || '').trim();
        if (!raw || el.children.length > 0)
            return;
        // Formato moeda R$ 1.234,56
        if (raw.startsWith('R$')) {
            const cleaned = raw.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.');
            const targetVal = Number.parseFloat(cleaned);
            if (!Number.isFinite(targetVal) || targetVal === 0)
                return;
            const proxy = { val: 0 };
            gsap.to(proxy, {
                val: targetVal,
                duration: 0.85,
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
        // Formato porcentagem 85% ou 85.5%
        if (/^\d+(?:[.,]\d+)?%$/.test(raw)) {
            const hasDecimal = raw.includes(',') || raw.includes('.');
            const targetVal = Number.parseFloat(raw.replace('%', '').replace(',', '.'));
            if (!Number.isFinite(targetVal) || targetVal === 0)
                return;
            const proxy = { val: 0 };
            gsap.to(proxy, {
                val: targetVal,
                duration: 0.75,
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
        // Formato inteiro puro (ex: 24, 1.250)
        if (/^\d[\d.]*$/.test(raw)) {
            const targetVal = Number.parseInt(raw.replace(/\./g, ''), 10);
            if (!Number.isFinite(targetVal) || targetVal === 0)
                return;
            const proxy = { val: 0 };
            gsap.to(proxy, {
                val: targetVal,
                duration: 0.75,
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
export function animateChartsAndBars(container = document) {
    const gsap = getGsap();
    if (!gsap)
        return;
    // Barras de preenchimento (.bar-fill, .progress-fill, etc.)
    const bars = container.querySelectorAll('.bar-fill, .quota-bar-fill, .chart-bar-fill');
    if (bars.length) {
        bars.forEach((bar) => {
            const targetWidth = bar.style.width;
            if (!targetWidth || targetWidth === '0%')
                return;
            gsap.fromTo(bar, { width: '0%' }, { width: targetWidth, duration: 0.82, ease: 'power3.out' });
        });
    }
    // Sparklines SVG
    const polylines = container.querySelectorAll('svg polyline, svg path.sparkline-path');
    polylines.forEach((line) => {
        try {
            const len = typeof line.getTotalLength === 'function' ? line.getTotalLength() : 0;
            if (len > 0) {
                gsap.fromTo(line, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.95, ease: 'power2.out' });
            }
        }
        catch {
            /* elemento SVG sem geometria calculável */
        }
    });
}
/** Anima a transição completa de qualquer View do Painel (#content). */
export function animatePanelView(container = document.getElementById('content')) {
    const gsap = getGsap();
    if (!gsap || !container)
        return;
    // Título da topbar
    const pageTitle = document.getElementById('page-title');
    const pageSub = document.getElementById('page-sub');
    if (pageTitle) {
        gsap.fromTo([pageTitle, pageSub].filter(Boolean), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.26, stagger: 0.04, ease: 'power2.out', clearProps: 'transform' });
    }
    const tl = gsap.timeline();
    // Cards de KPI
    const kpis = container.querySelectorAll('.kpi');
    if (kpis.length) {
        tl.fromTo(kpis, { opacity: 0, y: 18, scale: 0.97 }, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.36,
            stagger: 0.042,
            ease: 'power3.out',
            clearProps: 'transform',
        }, 0);
    }
    // Toolbars, cards principais e seções
    const cards = container.querySelectorAll('.toolbar, .card, .notice, .grid-2 > *, .grid-3 > *');
    if (cards.length) {
        tl.fromTo(cards, { opacity: 0, y: 16 }, {
            opacity: 1,
            y: 0,
            duration: 0.38,
            stagger: 0.035,
            ease: 'power3.out',
            clearProps: 'transform',
        }, kpis.length ? 0.08 : 0);
    }
    // Linhas de tabelas (limitado às primeiras 25 para performance máxima)
    const rows = Array.from(container.querySelectorAll('tbody tr')).slice(0, 25);
    if (rows.length) {
        tl.fromTo(rows, { opacity: 0, y: 8 }, {
            opacity: 1,
            y: 0,
            duration: 0.26,
            stagger: 0.018,
            ease: 'power2.out',
            clearProps: 'transform',
        }, 0.12);
    }
    // Blocos da agenda
    const apptBlocks = container.querySelectorAll('.appt-block, .agenda-event');
    if (apptBlocks.length) {
        tl.fromTo(apptBlocks, { opacity: 0, scale: 0.92, y: 6 }, {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 0.32,
            stagger: 0.025,
            ease: 'back.out(1.5)',
            clearProps: 'transform',
        }, 0.1);
    }
    animateNumbers(container);
    animateChartsAndBars(container);
}
/* ==========================================================================
   MODAIS E TOASTS (public/js/ui.js)
   ========================================================================== */
/** Anima a abertura de um modal e seus campos internos. */
export function animateModalOpen(backdrop, modal) {
    const gsap = getGsap();
    if (!gsap)
        return;
    gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power2.out' });
    gsap.fromTo(modal, { opacity: 0, y: 20, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'back.out(1.35)', clearProps: 'transform' });
    const fields = modal.querySelectorAll('.field, .form-grid > *, .booking-summary > div');
    if (fields.length) {
        gsap.fromTo(fields, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.24, stagger: 0.025, delay: 0.06, ease: 'power2.out', clearProps: 'transform' });
    }
}
/** Anima o fechamento suave do modal antes de remover do DOM. */
export function animateModalClose(backdrop, modal, onDone) {
    const gsap = getGsap();
    if (!gsap) {
        onDone();
        return;
    }
    if (modal) {
        gsap.to(modal, { opacity: 0, y: 12, scale: 0.96, duration: 0.16, ease: 'power2.in' });
    }
    gsap.to(backdrop, {
        opacity: 0,
        duration: 0.18,
        ease: 'power2.in',
        onComplete: onDone,
    });
}
/** Anima a entrada e saída de uma notificação Toast. */
export function animateToastIn(node) {
    const gsap = getGsap();
    if (!gsap)
        return;
    gsap.fromTo(node, { opacity: 0, x: 36, y: -6, scale: 0.92 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.36, ease: 'back.out(1.6)', clearProps: 'transform' });
    gsap.to(node, {
        opacity: 0,
        x: 28,
        scale: 0.95,
        duration: 0.24,
        delay: 4.1,
        ease: 'power2.in',
    });
}
/* ==========================================================================
   ANIMAÇÕES DA PÁGINA PÚBLICA DE AGENDAMENTO (/agendar)
   ========================================================================== */
/** Timeline cinematográfica de entrada da página /agendar. */
export function animateBookingBoot() {
    const gsap = getGsap();
    if (!gsap)
        return;
    const tl = gsap.timeline();
    const topNav = document.querySelector('.booking-top-nav');
    if (topNav) {
        tl.fromTo(topNav, { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.34, ease: 'power2.out', clearProps: 'transform' }, 0);
    }
    const heroCard = document.querySelector('.figma-hero-card');
    const heroBg = document.querySelector('.figma-hero-bg');
    if (heroCard) {
        tl.fromTo(heroCard, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', clearProps: 'transform' }, 0.05);
    }
    if (heroBg) {
        tl.fromTo(heroBg, { scale: 1.1 }, { scale: 1, duration: 1.25, ease: 'power2.out', clearProps: 'transform' }, 0.05);
    }
    const heroItems = document.querySelectorAll('.shop-kicker-row, .shop-profile-name, .shop-profile-meta, .shop-bio-text, .figma-amenity-chip, .shop-action-btn');
    if (heroItems.length) {
        tl.fromTo(heroItems, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.34, stagger: 0.035, ease: 'power2.out', clearProps: 'transform' }, 0.16);
    }
    const tabs = document.querySelectorAll('.shop-view-tabs .shop-tab-btn, #progress-container');
    if (tabs.length) {
        tl.fromTo(tabs, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' }, 0.24);
    }
    animateLookbookCards();
}
/** Anima os cards 4:5 do Lookbook e da aba Portfólio. */
export function animateLookbookCards(root = document) {
    const gsap = getGsap();
    if (!gsap)
        return;
    const cards = root.querySelectorAll('.figma-lookbook-card, .cut-card, .barber-rich-card, .review-item-card');
    if (!cards.length)
        return;
    gsap.fromTo(cards, { opacity: 0, y: 22, scale: 0.96 }, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.42,
        stagger: 0.06,
        ease: 'power3.out',
        clearProps: 'transform',
    });
}
/** Anima a lista de serviços ao filtrar ou carregar. */
export function animateServicesList(grid) {
    const gsap = getGsap();
    if (!gsap || !grid)
        return;
    const rows = grid.querySelectorAll('.booksy-service-row');
    if (!rows.length)
        return;
    gsap.fromTo(rows, { opacity: 0, y: 12 }, {
        opacity: 1,
        y: 0,
        duration: 0.3,
        stagger: 0.032,
        ease: 'power2.out',
        clearProps: 'transform',
    });
}
/** Anima a revelação progressiva de uma etapa (#sec-barber, #sec-date, #sec-form). */
export function animateBookingSectionReveal(section) {
    const gsap = getGsap();
    if (!gsap || !section)
        return;
    gsap.fromTo(section, { opacity: 0, y: 24, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'power3.out', clearProps: 'transform' });
    const items = section.querySelectorAll('.choice, .day-chip, .field');
    if (items.length) {
        gsap.fromTo(items, { opacity: 0, y: 12 }, {
            opacity: 1,
            y: 0,
            duration: 0.3,
            stagger: 0.035,
            delay: 0.06,
            ease: 'power2.out',
            clearProps: 'transform',
        });
    }
}
/** Anima os chips de dias disponíveis (#day-strip). */
export function animateDayStrip(strip) {
    const gsap = getGsap();
    if (!gsap || !strip)
        return;
    const chips = strip.querySelectorAll('.day-chip');
    if (!chips.length)
        return;
    gsap.fromTo(chips, { opacity: 0, y: 10, scale: 0.94 }, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.28,
        stagger: 0.022,
        ease: 'power2.out',
        clearProps: 'transform',
    });
}
/** Anima a grade de horários livres (#slot-area). */
export function animateSlotsGrid(area) {
    const gsap = getGsap();
    if (!gsap || !area)
        return;
    const slots = area.querySelectorAll('.slot');
    if (!slots.length)
        return;
    gsap.fromTo(slots, { opacity: 0, scale: 0.88, y: 8 }, {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 0.28,
        stagger: 0.016,
        ease: 'back.out(1.6)',
        clearProps: 'transform',
    });
}
let lastStickyPriceValue = 0;
/** Anima a barra inferior sticky estilo Booksy e faz count-up do preço selecionado. */
export function animateStickyBarPrice(targetPrice, stickyBar, priceEl) {
    const gsap = getGsap();
    if (!gsap)
        return;
    if (stickyBar && !stickyBar.dataset.gsapShown) {
        stickyBar.dataset.gsapShown = '1';
        gsap.fromTo(stickyBar, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.38, ease: 'power3.out', clearProps: 'transform' });
    }
    if (priceEl && Number.isFinite(targetPrice) && targetPrice !== lastStickyPriceValue) {
        const proxy = { val: lastStickyPriceValue || 0 };
        lastStickyPriceValue = targetPrice;
        gsap.to(proxy, {
            val: targetPrice,
            duration: 0.45,
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
/** Anima a tela de confirmação de agendamento concluído com celebração. */
export function animateBookingSuccess(container = document) {
    const gsap = getGsap();
    if (!gsap)
        return;
    const box = container.querySelector('.success-box');
    if (!box)
        return;
    const tl = gsap.timeline();
    tl.fromTo(box, { opacity: 0, y: 24, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.44, ease: 'power3.out', clearProps: 'transform' });
    const check = box.querySelector('.success-check');
    if (check) {
        tl.fromTo(check, { scale: 0, rotate: -30, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.52, ease: 'back.out(2.4)', clearProps: 'transform' }, '-=0.26');
    }
    const rows = box.querySelectorAll('h3, p, .booking-summary > div, .btn, .btn-calendar-add');
    if (rows.length) {
        tl.fromTo(rows, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.28, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' }, '-=0.28');
    }
}
