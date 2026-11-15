// Banner Interativo de Gestao de Consentimento (CMP) - LGPD
(function () {
  const STORAGE_KEY = 'barbearia_cookie_consent';

  function getSavedConsent() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  function saveConsent(consent) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
      fetch('/api/lgpd/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consent),
      }).catch(() => {});
    } catch {}
  }

  function createBanner() {
    if (document.getElementById('consent-banner-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'consent-banner-wrapper';
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
          <button id="consent-btn-custom" style="background: transparent; color: #A1A1AA; border: 1px solid rgba(255, 255, 255, 0.1); padding: 6px 10px; border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer;">
            Preferências
          </button>
          <button id="consent-btn-reject" style="background: #171920; color: #E4E4E7; border: 1px solid rgba(255, 255, 255, 0.08); padding: 6px 10px; border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer;">
            Essenciais
          </button>
          <button id="consent-btn-accept" style="background: #2563EB; color: #FFFFFF; border: none; padding: 6px 12px; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer;">
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

    document.body.appendChild(wrapper);
    if (window.gsap) {
      window.gsap.fromTo(
        wrapper,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out', clearProps: 'transform' }
      );
    }

    const customDiv = document.getElementById('consent-custom-options');
    const customBtn = document.getElementById('consent-btn-custom');

    const closeBanner = () => {
      if (window.gsap) {
        window.gsap.to(wrapper, {
          opacity: 0,
          y: 10,
          duration: 0.18,
          ease: 'power2.in',
          onComplete: () => wrapper.remove(),
        });
      } else {
        wrapper.remove();
      }
    };

    customBtn.onclick = () => {
      const opening = customDiv.style.display === 'none';
      customDiv.style.display = opening ? 'block' : 'none';
      customBtn.textContent = opening ? 'Fechar' : 'Preferências';
      if (opening && window.gsap) {
        window.gsap.fromTo(customDiv, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' });
      }
    };

    document.getElementById('consent-btn-accept').onclick = () => {
      saveConsent({ necessary: true, analytics: true, marketing: true, timestamp: new Date().toISOString() });
      closeBanner();
    };

    document.getElementById('consent-btn-reject').onclick = () => {
      saveConsent({ necessary: true, analytics: false, marketing: false, timestamp: new Date().toISOString() });
      closeBanner();
    };
  }

  window.reopenConsentModal = function () {
    const existing = document.getElementById('consent-banner-wrapper');
    if (existing) existing.remove();
    createBanner();
    const customDiv = document.getElementById('consent-custom-options');
    if (customDiv) customDiv.style.display = 'block';
  };

  if (!getSavedConsent()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createBanner);
    } else {
      createBanner();
    }
  }

  // Interacoes sem violacao de CSP (script-src 'self')
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-reopen-cookies');
    if (btn) {
      btn.addEventListener('click', () => {
        window.reopenConsentModal();
      });
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  });
})();
