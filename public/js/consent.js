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
      bottom: 20px;
      left: 20px;
      right: 20px;
      max-width: 680px;
      margin: 0 auto;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      z-index: 99999;
      font-family: inherit;
      line-height: 1.5;
    `;

    wrapper.innerHTML = `
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-size: 1.25rem;">🍪</span>
            <strong style="font-size: 1.05rem; color: #fff;">Privacidade & Cookies (LGPD)</strong>
          </div>
          <p style="font-size: 0.88rem; color: #94a3b8; margin: 0 0 16px 0;">
            Utilizamos cookies essenciais para autenticação e segurança. Você pode personalizar o uso de cookies opcionais para análise e melhoria de experiência. Saiba mais em nossa <a href="/privacidade.html" style="color: #38bdf8; text-decoration: underline;">Política de Privacidade</a> e <a href="/cookies.html" style="color: #38bdf8; text-decoration: underline;">Política de Cookies</a>.
          </p>
        </div>
      </div>

      <div id="consent-custom-options" style="display: none; margin-bottom: 16px; padding: 12px; background: #1e293b; border-radius: 8px; font-size: 0.82rem;">
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: #e2e8f0;">
          <input type="checkbox" checked disabled> <strong>Essenciais (Segurança e Sessão):</strong> Obrigatórios para o funcionamento da plataforma.
        </label>
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: #e2e8f0; cursor: pointer;">
          <input type="checkbox" id="consent-opt-analytics" checked> <strong>Analíticos:</strong> Métricas anônimas de uso e performance.
        </label>
        <label style="display: flex; align-items: center; gap: 8px; color: #e2e8f0; cursor: pointer;">
          <input type="checkbox" id="consent-opt-marketing"> <strong>Comunicação e WhatsApp:</strong> Lembretes opcionais e novidades.
        </label>
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; align-items: center;">
        <button id="consent-btn-custom" style="background: transparent; color: #94a3b8; border: 1px solid #475569; padding: 8px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">
          ⚙️ Personalizar
        </button>
        <button id="consent-btn-reject" style="background: #334155; color: #f1f5f9; border: none; padding: 8px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">
          Apenas Necessários
        </button>
        <button id="consent-btn-accept" style="background: #0284c7; color: #ffffff; border: none; padding: 8px 18px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer;">
          Aceitar Todos
        </button>
      </div>
    `;

    document.body.appendChild(wrapper);

    const customDiv = document.getElementById('consent-custom-options');
    const customBtn = document.getElementById('consent-btn-custom');

    customBtn.onclick = () => {
      customDiv.style.display = customDiv.style.display === 'none' ? 'block' : 'none';
      customBtn.textContent = customDiv.style.display === 'none' ? '⚙️ Personalizar' : 'Fechar Opções';
    };

    document.getElementById('consent-btn-accept').onclick = () => {
      saveConsent({ necessary: true, analytics: true, marketing: true, timestamp: new Date().toISOString() });
      wrapper.remove();
    };

    document.getElementById('consent-btn-reject').onclick = () => {
      saveConsent({ necessary: true, analytics: false, marketing: false, timestamp: new Date().toISOString() });
      wrapper.remove();
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
})();
