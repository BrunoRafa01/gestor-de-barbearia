// Gerenciamento e Auditoria de Compliance (LGPD, DSR e Requisitos)
document.addEventListener('DOMContentLoaded', () => {
  // 1. Exportacao de Dados
  const exportForm = document.getElementById('exportForm');
  if (exportForm) {
    exportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('exportPhone').value;
      const resEl = document.getElementById('exportResult');
      resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-blue-50 text-blue-700 block';
      resEl.textContent = 'Consultando e preparando arquivo seguro...';

      try {
        const res = await fetch(`/api/lgpd/export?phone=${encodeURIComponent(phone)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao exportar dados.');

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meus-dados-barbearia-${Date.now()}.json`;
        a.click();

        resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-emerald-50 text-emerald-800 block';
        resEl.innerHTML = `✅ <strong>Exportação concluída!</strong> O arquivo JSON com ${data.agendamentos.length} registro(s) foi baixado para seu dispositivo.`;
      } catch (err) {
        resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-rose-50 text-rose-800 block';
        resEl.textContent = '❌ ' + err.message;
      }
    });
  }

  // 2. Envio DSR
  const dsrForm = document.getElementById('dsrForm');
  if (dsrForm) {
    dsrForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const resEl = document.getElementById('dsrResult');
      resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-blue-50 text-blue-700 block';
      resEl.textContent = 'Registrando solicitação formal...';

      const payload = {
        name: document.getElementById('dsrName').value,
        phone: document.getElementById('dsrPhone').value,
        email: document.getElementById('dsrEmail').value,
        requestType: document.getElementById('dsrType').value,
        message: document.getElementById('dsrMessage').value,
      };

      try {
        const res = await fetch('/api/lgpd/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao registrar.');

        resEl.className = 'mt-4 p-4 rounded-lg text-sm bg-emerald-50 text-emerald-900 border border-emerald-200 block';
        resEl.innerHTML = `
          <div class="font-bold text-base mb-1">🎉 Protocolo Gerado: <span class="font-mono text-emerald-700">${data.protocolo}</span></div>
          <p>${data.mensagem}</p>
          <p class="text-xs text-slate-500 mt-2">Dúvidas? Escreva para <strong>${data.contato_dpo}</strong> com o número do protocolo.</p>
        `;
        dsrForm.reset();
      } catch (err) {
        resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-rose-50 text-rose-800 block';
        resEl.textContent = '❌ ' + err.message;
      }
    });
  }

  // 3. Carregar 40 Requisitos
  async function loadCompliance() {
    const loading = document.getElementById('complianceLoading');
    const grid = document.getElementById('complianceGrid');
    if (!loading || !grid) return;

    try {
      const res = await fetch('/api/compliance/status');
      const data = await res.json();

      grid.innerHTML = data.requisitos.map(r => `
        <div class="req-item">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-semibold text-slate-400">#${String(r.id).padStart(2, '0')}</span>
            <span class="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">${r.category}</span>
          </div>
          <strong>${r.name}</strong>
          <div class="text-slate-600 text-xs mt-1">${r.evidence}</div>
        </div>
      `).join('');

      loading.classList.add('hidden');
      grid.classList.remove('hidden');
    } catch (err) {
      loading.textContent = 'Erro ao carregar auditoria: ' + err.message;
    }
  }

  loadCompliance();
});
