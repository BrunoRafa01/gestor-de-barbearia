/**
 * Gerenciamento e Auditoria de Compliance (LGPD, DSR e Requisitos) — NOVA RUNTIME
 */

interface ExportResponse {
  error?: string;
  agendamentos?: unknown[];
}

interface DsrResponse {
  error?: string;
  protocolo?: string;
  mensagem?: string;
  contato_dpo?: string;
}

interface ComplianceReqItem {
  id: number;
  category: string;
  name: string;
  evidence: string;
}

interface ComplianceStatusResponse {
  requisitos?: ComplianceReqItem[];
}

import { esc as escHtml } from './ui.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro inesperado.';
}

function initCompliancePage(): void {
  // 1. Exportação de Dados
  const exportForm = document.getElementById('exportForm') as HTMLFormElement | null;
  if (exportForm) {
    exportForm.addEventListener('submit', (e: SubmitEvent) => {
      e.preventDefault();
      void (async () => {
        const phoneInput = document.getElementById('exportPhone') as HTMLInputElement | null;
        const resEl = document.getElementById('exportResult');
        if (!phoneInput || !resEl) return;

        const phone = phoneInput.value.trim();
        resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-blue-50 text-blue-700 block';
        resEl.textContent = 'Consultando e preparando arquivo seguro...';

        try {
          const res = await fetch(`/api/lgpd/export?phone=${encodeURIComponent(phone)}`);
          const data = (await res.json()) as ExportResponse;
          if (!res.ok) throw new Error(data.error || 'Erro ao exportar dados.');

          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `meus-dados-barbearia-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);

          const count = Array.isArray(data.agendamentos) ? data.agendamentos.length : 0;
          resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-emerald-50 text-emerald-800 block';
          resEl.innerHTML = `<strong>Exportação concluída!</strong> O arquivo JSON com ${count} registro(s) foi baixado para seu dispositivo.`;
        } catch (err: unknown) {
          resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-rose-50 text-rose-800 block';
          resEl.textContent = errMsg(err);
        }
      })();
    });
  }

  // 2. Envio DSR
  const dsrForm = document.getElementById('dsrForm') as HTMLFormElement | null;
  if (dsrForm) {
    dsrForm.addEventListener('submit', (e: SubmitEvent) => {
      e.preventDefault();
      void (async () => {
        const resEl = document.getElementById('dsrResult');
        if (!resEl) return;
        resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-blue-50 text-blue-700 block';
        resEl.textContent = 'Registrando solicitação formal...';

        const nameEl = document.getElementById('dsrName') as HTMLInputElement | null;
        const phoneEl = document.getElementById('dsrPhone') as HTMLInputElement | null;
        const emailEl = document.getElementById('dsrEmail') as HTMLInputElement | null;
        const typeEl = document.getElementById('dsrType') as HTMLSelectElement | null;
        const msgEl = document.getElementById('dsrMessage') as HTMLTextAreaElement | null;

        const payload = {
          name: nameEl?.value ?? '',
          phone: phoneEl?.value ?? '',
          email: emailEl?.value ?? '',
          requestType: typeEl?.value ?? 'acesso',
          message: msgEl?.value ?? '',
        };

        try {
          const res = await fetch('/api/lgpd/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = (await res.json()) as DsrResponse;
          if (!res.ok) throw new Error(data.error || 'Erro ao registrar.');

          resEl.className = 'mt-4 p-4 rounded-lg text-sm bg-emerald-50 text-emerald-900 border border-emerald-200 block';
          resEl.innerHTML = `
            <div class="font-bold text-base mb-1">Protocolo Gerado: <span class="font-mono text-emerald-700">${escHtml(data.protocolo)}</span></div>
            <p>${escHtml(data.mensagem)}</p>
            <p class="text-xs text-slate-500 mt-2">Dúvidas? Escreva para <strong>${escHtml(data.contato_dpo)}</strong> com o número do protocolo.</p>
          `;
          dsrForm.reset();
        } catch (err: unknown) {
          resEl.className = 'mt-4 p-3 rounded-lg text-sm bg-rose-50 text-rose-800 block';
          resEl.textContent = errMsg(err);
        }
      })();
    });
  }

  // 3. Carregar 40 Requisitos
  async function loadCompliance(): Promise<void> {
    const loading = document.getElementById('complianceLoading');
    const grid = document.getElementById('complianceGrid');
    if (!loading || !grid) return;

    try {
      const res = await fetch('/api/compliance/status');
      const data = (await res.json()) as ComplianceStatusResponse;
      const list = Array.isArray(data.requisitos) ? data.requisitos : [];

      grid.innerHTML = list
        .map(
          (r) => `
          <div class="req-item">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-semibold text-slate-400">#${String(r.id).padStart(2, '0')}</span>
              <span class="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">${escHtml(r.category)}</span>
            </div>
            <strong>${escHtml(r.name)}</strong>
            <div class="text-slate-600 text-xs mt-1">${escHtml(r.evidence)}</div>
          </div>`
        )
        .join('');

      loading.classList.add('hidden');
      grid.classList.remove('hidden');
    } catch (err: unknown) {
      loading.textContent = `Erro ao carregar auditoria: ${errMsg(err)}`;
    }
  }

  void loadCompliance();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCompliancePage, { once: true });
} else {
  initCompliancePage();
}
