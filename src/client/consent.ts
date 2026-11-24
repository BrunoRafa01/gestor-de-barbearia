/**
 * Banner Interativo de Gestão de Consentimento (CMP) - LGPD — NOVA RUNTIME
 */

interface ConsentState {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  timestamp: string;
}

declare global {
  interface Window {
    reopenConsentModal?: () => void;
  }
}

const STORAGE_KEY = 'barbearia_cookie_consent';

function getSavedConsent(): ConsentState | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? (JSON.parse(data) as ConsentState) : null;
  } catch {
    return null;
  }
}

function saveConsent(consent: ConsentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    void fetch('/api/lgpd/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(consent),
    }).catch(() => {});
  } catch {
    /* armazena apenas em memória se localStorage bloqueado */
  }
}

function createBanner(): void {
  if (document.getElementById('consent-banner-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'consent-banner-wrapper';
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', 'Preferências de Cookies e Privacidade');
  wrapper.style.cssText = `
    position: fixed;
    bottom: 14px;
    right: 14px;
    left: 14px;
    max-width: 560px;
    margin-left: auto;
    background: rgba(14, 16, 21, 0.96);
    backdrop-filter: blur(10px);
    color: #E4E4E7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 12px 16px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
    z-index: 99999;
    font-family: inherit;
    line-height: 1.4;
  `;

  wrapper.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;">
      <div style="flex: 1 1 260px; min-width: 0;">
        <strong style="display: block; font-size: 12.5px; font-weight: 600; color: #F4F4F5; margin-bottom: 2px;">Cookies &amp; Privacidade (LGPD)</strong>
        <p style="font-size: 12px; color: #A1A1AA; margin: 0;">
          Usamos cookies essenciais de sessão e segurança. <a href="/privacidade.html" style="color: #60A5FA; text-decoration: underline;">Privacidade</a> · <a href="/cookies.html" style="color: #60A5FA; text-decoration: underline;">Cookies</a>
        </p>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
        <button type="button" id="consent-btn-custom" style="background: transparent; color: #A1A1AA; border: 1px solid rgba(255, 255, 255, 0.1); padding: 6px 10px; border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer;">
          Preferências
        </button>
        <button type="button" id="consent-btn-reject" style="background: #171920; color: #E4E4E7; border: 1px solid rgba(255, 255, 255, 0.08); padding: 6px 10px; border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer;">
          Essenciais
        </button>
        <button type="button" id="consent-btn-accept" style="background: #2563EB; color: #FFFFFF; border: none; padding: 6px 12px; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer;">
          Aceitar
        </button>
      </div>
    </div>

    <div id="consent-custom-options" style="display: none; margin-top: 10px; padding: 10px; background: #17181E; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; font-size: 12px;">
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: #F4F4F5;">
        <input type="checkbox" checked disabled> <strong>Essenciais:</strong> Obrigatórios para autenticação e segurança.
      </label>
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: #F4F4F5; cursor: pointer;">
        <input type="checkbox" id="consent-opt-analytics" checked> <strong>Analíticos:</strong> Métricas anônimas de uso.
      </label>
      <label style="display: flex; align-items: center; gap: 8px; color: #F4F4F5; cursor: pointer;">
        <input type="checkbox" id="consent-opt-marketing"> <strong>Comunicação:</strong> Lembretes e novidades via WhatsApp.
      </label>
    </div>
  `;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) {
    wrapper.style.opacity = '0';
    wrapper.style.transform = 'translateY(10px)';
    wrapper.style.transition = 'opacity 220ms ease, transform 220ms ease';
  }

  document.body.appendChild(wrapper);
  if (!reducedMotion) {
    requestAnimationFrame(() => {
      wrapper.style.opacity = '1';
      wrapper.style.transform = 'translateY(0)';
    });
  }

  const customDiv = document.getElementById('consent-custom-options');
  const customBtn = document.getElementById('consent-btn-custom');
  const acceptBtn = document.getElementById('consent-btn-accept');
  const rejectBtn = document.getElementById('consent-btn-reject');

  const closeBanner = (): void => {
    if (reducedMotion) {
      wrapper.remove();
      return;
    }
    wrapper.style.opacity = '0';
    wrapper.style.transform = 'translateY(8px)';
    window.setTimeout(() => wrapper.remove(), 180);
  };

  customBtn?.addEventListener('click', () => {
    if (!customDiv || !customBtn) return;
    const opening = customDiv.style.display === 'none';
    customDiv.style.display = opening ? 'block' : 'none';
    customBtn.textContent = opening ? 'Fechar' : 'Preferências';
    if (opening && acceptBtn) {
      acceptBtn.textContent = 'Salvar';
    } else if (acceptBtn) {
      acceptBtn.textContent = 'Aceitar';
    }
  });

  acceptBtn?.addEventListener('click', () => {
    const isCustomOpen = customDiv?.style.display === 'block';
    const analyticsOpt = document.getElementById('consent-opt-analytics') as HTMLInputElement | null;
    const marketingOpt = document.getElementById('consent-opt-marketing') as HTMLInputElement | null;
    saveConsent({
      necessary: true,
      analytics: isCustomOpen ? Boolean(analyticsOpt?.checked) : true,
      marketing: isCustomOpen ? Boolean(marketingOpt?.checked) : true,
      timestamp: new Date().toISOString(),
    });
    closeBanner();
  });

  rejectBtn?.addEventListener('click', () => {
    saveConsent({
      necessary: true,
      analytics: false,
      marketing: false,
      timestamp: new Date().toISOString(),
    });
    closeBanner();
  });
}

window.reopenConsentModal = (): void => {
  const existing = document.getElementById('consent-banner-wrapper');
  if (existing) existing.remove();
  createBanner();
  const customDiv = document.getElementById('consent-custom-options');
  if (customDiv) customDiv.style.display = 'block';
};

function bootConsent(): void {
  if (!getSavedConsent()) {
    createBanner();
  }
  const btn = document.getElementById('btn-reopen-cookies');
  btn?.addEventListener('click', () => {
    window.reopenConsentModal?.();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootConsent, { once: true });
} else {
  bootConsent();
}

export {};
