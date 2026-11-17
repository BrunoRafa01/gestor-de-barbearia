/**
 * Controlador TypeScript da Torre de Controle Master (/master)
 * Radar Anti-BO, Inspetor de Banco de Dados em Tempo Real, Integridade de Código-Fonte e GSAP Motion.
 */
import { animateNumbers, getGsap, initGsapMotion } from './gsap-motion.js';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let currentRiskFilter = 'all';
let currentInspectedTable = 'audit_events';
function esc(val) {
    return String(val ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
async function masterFetch(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Master-Console': '1',
            ...(options.headers || {}),
        },
    });
    if (res.status === 401 || res.status === 403) {
        // Tenta elevar sessao automaticamente em modo demo ou solicita senha master
        const elev = await fetch('/api/auth/master-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (elev.ok) {
            const retry = await fetch(path, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Master-Console': '1',
                    ...(options.headers || {}),
                },
            });
            if (retry.ok)
                return (await retry.json());
        }
        const pwd = window.prompt('Digite a Senha Master do Proprietário para acessar a Torre de Controle:');
        if (pwd) {
            const authRes = await fetch('/api/auth/master-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd }),
            });
            if (authRes.ok) {
                const retry2 = await fetch(path, {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Master-Console': '1',
                        ...(options.headers || {}),
                    },
                });
                if (retry2.ok)
                    return (await retry2.json());
            }
        }
        throw new Error('Acesso restrito ao Proprietário Master.');
    }
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Erro HTTP ${res.status}`);
    }
    return (await res.json());
}
function setText(id, text) {
    const el = document.getElementById(id);
    if (el)
        el.textContent = text;
}
async function loadOverviewAndIntegrity() {
    const [overview, integrity] = await Promise.all([
        masterFetch('/api/master/overview'),
        masterFetch('/api/master/integrity'),
    ]);
    const boTotal = Number(overview.audit?.critical_bo || 0);
    const warnTotal = Number(overview.audit?.warnings || 0);
    setText('kpi-bo-count', String(boTotal));
    setText('tab-bo-badge', `${boTotal} BOs`);
    setText('kpi-bo-sub', `${boTotal} BO(s) crítico(s) · ${warnTotal} alerta(s) sensível(is)`);
    // Git & Código-Fonte
    const gitClean = Boolean(integrity.git?.clean);
    const modCount = (integrity.git?.modified_files || []).length;
    setText('kpi-git-commit', `#${integrity.git?.commit || 'HEAD'}`);
    setText('kpi-git-sub', gitClean
        ? `Branch ${integrity.git?.branch || 'main'} · Código 100% íntegro`
        : `ATENÇÃO: ${modCount} arquivo(s) modificado(s) no servidor!`);
    const gitBadge = document.getElementById('kpi-git-badge');
    const intPill = document.getElementById('integrity-status-pill');
    if (gitBadge) {
        gitBadge.className = `risk-pill ${gitClean ? 'normal' : 'critical_bo'}`;
        gitBadge.textContent = gitClean ? 'ÍNTEGRO' : `${modCount} ALTERADO(S)`;
    }
    if (intPill) {
        intPill.className = `risk-pill ${gitClean ? 'normal' : 'critical_bo'}`;
        intPill.textContent = gitClean ? 'CÓDIGO ÍNTEGRO' : 'MODIFICAÇÃO DETECTADA';
    }
    // Banco de dados
    setText('kpi-db-driver', String(overview.driver || 'sqlite').toUpperCase());
    setText('kpi-db-sub', `Latência: ${Number(overview.database?.latency_ms || 0)} ms · ${Number(overview.appointments?.total || 0)} agendamentos`);
    // GMV
    setText('kpi-gmv-val', brl.format(Number(overview.appointments?.gmv || 0)));
    setText('kpi-shops-badge', `${Number(overview.shops?.active || 1)} ATIVA(S)`);
    setText('kpi-gmv-sub', `${Number(overview.appointments?.cancelled_or_noshow || 0)} cancelamento(s)/falta(s) monitorados`);
    // Renderiza tabela de Checksums SHA-256
    const filesTbody = document.getElementById('integrity-files-tbody');
    if (filesTbody && Array.isArray(integrity.files)) {
        filesTbody.innerHTML = integrity.files
            .map((f) => `
        <tr>
          <td class="mono"><strong>${esc(f.file)}</strong></td>
          <td class="mono" style="color:#60A5FA">${esc(f.sha256 || 'AUSENTE')}</td>
          <td class="mono">${(Number(f.size_bytes || 0) / 1024).toFixed(1)} KB</td>
          <td class="mono" style="color:var(--muted)">${esc((f.mtime || '').replace('T', ' ').slice(0, 19))}</td>
        </tr>`)
            .join('');
    }
    // Renderiza box de Git & Runtime
    const gitBox = document.getElementById('integrity-git-box');
    if (gitBox) {
        const modList = (integrity.git?.modified_files || [])
            .map((line) => `<li class="mono" style="color:#FCA5A5">${esc(line)}</li>`)
            .join('');
        gitBox.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px">
        <div>
          <span style="color:var(--muted)">Último Commit:</span>
          <div class="mono" style="margin-top:4px;color:var(--text)">${esc(integrity.git?.last_commit || 'N/A')}</div>
        </div>
        <div>
          <span style="color:var(--muted)">Estado dos Arquivos Fonte:</span>
          ${gitClean
            ? `<div style="margin-top:6px;padding:10px;border-radius:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);color:#6EE7B7">
                  ✓ Nenhum arquivo do código-fonte foi adulterado fora do Git.
                 </div>`
            : `<div style="margin-top:6px;padding:10px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35)">
                  <strong style="color:#FCA5A5">Arquivos modificados no servidor:</strong>
                  <ul style="margin:6px 0 0;padding-left:18px">${modList}</ul>
                 </div>`}
        </div>
        <div style="padding-top:10px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:8px" class="mono">
          <div>Node: <strong>${esc(integrity.runtime?.node_version)}</strong></div>
          <div>PID: <strong>${esc(integrity.runtime?.pid)}</strong></div>
          <div>RAM RSS: <strong>${esc(integrity.runtime?.rss_mb)} MB</strong></div>
          <div>Uptime: <strong>${esc(integrity.runtime?.uptime_seconds)}s</strong></div>
        </div>
      </div>
    `;
    }
}
async function loadAuditFeed() {
    const data = await masterFetch(`/api/master/audit?risk=${encodeURIComponent(currentRiskFilter)}`);
    const listEl = document.getElementById('audit-feed-list');
    if (listEl) {
        const events = Array.isArray(data.events) ? data.events : [];
        if (!events.length) {
            listEl.innerHTML = `<div class="mono" style="color:var(--muted)">Nenhum evento registrado neste filtro.</div>`;
        }
        else {
            listEl.innerHTML = events
                .map((ev) => {
                const risk = String(ev.risk_level || 'normal');
                const pillLabel = risk === 'critical_bo' ? 'BO CRÍTICO' : risk === 'warning' ? 'ALERTA' : 'NORMAL';
                return `
            <article class="audit-item ${esc(risk)}">
              <div class="audit-top">
                <span class="audit-title">${esc(ev.action_label)}</span>
                <span class="risk-pill ${esc(risk)}">${pillLabel}</span>
              </div>
              ${ev.bo_reason ? `<div class="audit-reason">${esc(ev.bo_reason)}</div>` : ''}
              <div class="audit-meta">
                <span>Autor: <strong>${esc(ev.actor)}</strong> (${esc(ev.actor_role)})</span>
                <span>Rota: ${esc(ev.method)} ${esc(ev.path)}</span>
                <span>HTTP ${Number(ev.status_code || 200)}</span>
                <span>Data: ${esc(ev.created_at)}</span>
              </div>
              ${ev.payload_summary
                    ? `<div class="mono" style="font-size:10.5px;color:var(--faint);word-break:break-all">Dados: ${esc(ev.payload_summary)}</div>`
                    : ''}
            </article>
          `;
            })
                .join('');
            const gsap = getGsap();
            if (gsap) {
                gsap.fromTo(listEl.querySelectorAll('.audit-item'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.24, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' });
            }
        }
    }
    const barberTbody = document.getElementById('barber-anomaly-tbody');
    if (barberTbody && Array.isArray(data.barber_anomalies)) {
        barberTbody.innerHTML = data.barber_anomalies
            .map((b) => {
            const badCount = Number(b.cancelled_count || 0) + Number(b.noshow_count || 0);
            const riskClass = b.suspect_flag ? 'critical_bo' : b.bo_rate >= 10 ? 'warning' : 'normal';
            return `
          <tr>
            <td><strong>${esc(b.name)}</strong><br><span class="mono" style="font-size:10.5px;color:var(--muted)">Comissão: ${Number(b.commission)}%</span></td>
            <td class="mono">${Number(b.completed_count)} (${brl.format(Number(b.total_revenue || 0))})</td>
            <td class="mono" style="color:${badCount > 0 ? '#FCA5A5' : 'var(--muted)'}">${badCount} (${brl.format(Number(b.lost_revenue || 0))})</td>
            <td><span class="risk-pill ${riskClass}">${Number(b.bo_rate)}%</span></td>
          </tr>
        `;
        })
            .join('');
    }
}
async function loadDatabaseInspector() {
    const dbInfo = await masterFetch('/api/master/database');
    const grid = document.getElementById('db-tables-grid');
    const meta = document.getElementById('db-file-meta');
    if (meta) {
        const kb = (Number(dbInfo.file_size_bytes || 0) / 1024).toFixed(1);
        meta.textContent = `${dbInfo.driver.toUpperCase()} · ${kb} KB · ${dbInfo.file_path || ''}`;
    }
    const tables = Array.isArray(dbInfo.tables) ? dbInfo.tables : [];
    setText('tab-db-badge', `${tables.length} tabelas`);
    if (grid) {
        grid.innerHTML = tables
            .map((t) => `
        <div class="db-table-chip ${t.table === currentInspectedTable ? 'active' : ''}" data-table="${esc(t.table)}">
          <strong>${esc(t.table)}</strong>
          <span>${Number(t.rows)} reg.</span>
        </div>`)
            .join('');
        grid.querySelectorAll('.db-table-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                currentInspectedTable = chip.dataset.table || 'audit_events';
                grid.querySelectorAll('.db-table-chip').forEach((c) => c.classList.remove('active'));
                chip.classList.add('active');
                inspectTableRows(currentInspectedTable);
            });
        });
    }
    await inspectTableRows(currentInspectedTable);
}
async function inspectTableRows(tableName) {
    setText('db-inspect-title', `Tabela selecionada: ${tableName} (últimos 25 registros ao vivo)`);
    const container = document.getElementById('db-rows-container');
    if (!container)
        return;
    const data = await masterFetch(`/api/master/database/${encodeURIComponent(tableName)}`);
    const cols = Array.isArray(data.columns) ? data.columns : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) {
        container.innerHTML = `<div class="mono" style="padding:14px;color:var(--muted)">Tabela vazia (0 registros).</div>`;
        return;
    }
    container.innerHTML = `
    <table class="m-table">
      <thead>
        <tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows
        .map((r) => `<tr>${cols
        .map((c) => `<td class="mono">${esc(r[c] === null ? 'NULL' : r[c])}</td>`)
        .join('')}</tr>`)
        .join('')}
      </tbody>
    </table>
  `;
}
async function loadShopsControl() {
    const shops = await masterFetch('/api/master/shops');
    const tbody = document.getElementById('master-shops-tbody');
    if (!tbody)
        return;
    tbody.innerHTML = (shops || [])
        .map((s) => `
      <tr>
        <td class="mono">#${Number(s.id)}</td>
        <td><strong>${esc(s.name)}</strong><br><span class="mono" style="font-size:11px;color:var(--muted)">/b/${esc(s.slug)}</span></td>
        <td>
          <select class="m-btn master-plan-sel" data-shop-id="${Number(s.id)}" style="padding:5px 10px">
            <option value="free" ${s.plan_id === 'free' ? 'selected' : ''}>Gratuito / Demo</option>
            <option value="basic" ${s.plan_id === 'basic' ? 'selected' : ''}>Básico</option>
            <option value="pro" ${s.plan_id === 'pro' ? 'selected' : ''}>Profissional</option>
          </select>
        </td>
        <td class="mono">${Number(s.barbers_count || 0)}</td>
        <td class="mono">${Number(s.appointments_count || 0)}</td>
        <td class="mono" style="color:${Number(s.bo_cancelled_count || 0) > 0 ? '#FCA5A5' : 'var(--muted)'}">${Number(s.bo_cancelled_count || 0)}</td>
        <td>
          <span class="risk-pill ${s.active ? 'normal' : 'critical_bo'}">${s.active ? 'ATIVA' : 'SUSPENSA'}</span>
        </td>
        <td>
          <button type="button" class="m-btn ${s.active ? 'm-btn-danger' : 'm-btn-primary'}" data-toggle-shop="${Number(s.id)}" data-next="${s.active ? 0 : 1}">
            ${s.active ? 'Suspender Barbearia' : 'Reativar Barbearia'}
          </button>
        </td>
      </tr>
    `)
        .join('');
    tbody.querySelectorAll('.master-plan-sel').forEach((sel) => {
        sel.addEventListener('change', async () => {
            await masterFetch(`/api/master/shops/${sel.dataset.shopId}`, {
                method: 'PATCH',
                body: JSON.stringify({ plan_id: sel.value }),
            });
            await loadShopsControl();
        });
    });
    tbody.querySelectorAll('[data-toggle-shop]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const nextActive = Number(btn.dataset.next) === 1;
            await masterFetch(`/api/master/shops/${btn.dataset.toggleShop}`, {
                method: 'PATCH',
                body: JSON.stringify({ active: nextActive }),
            });
            await Promise.all([loadOverviewAndIntegrity(), loadShopsControl()]);
        });
    });
}
async function refreshAllMasterData() {
    await Promise.all([
        loadOverviewAndIntegrity(),
        loadAuditFeed(),
        loadDatabaseInspector(),
        loadShopsControl(),
    ]);
    animateNumbers(document);
}
function initMasterUI() {
    initGsapMotion();
    // Abas
    const tabs = document.querySelectorAll('.master-tab');
    const panes = document.querySelectorAll('.view-pane');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.remove('active'));
            panes.forEach((p) => p.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.dataset.pane || 'pane-audit';
            const pane = document.getElementById(targetId);
            if (pane) {
                pane.classList.add('active');
                const gsap = getGsap();
                if (gsap) {
                    gsap.fromTo(pane, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform' });
                }
            }
        });
    });
    // Filtros de Risco
    const filterBtns = document.querySelectorAll('.filter-pill');
    filterBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            filterBtns.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            currentRiskFilter = btn.dataset.risk || 'all';
            loadAuditFeed();
        });
    });
    // Botao Simular BO
    const simBtn = document.getElementById('btn-simulate-bo');
    if (simBtn) {
        simBtn.addEventListener('click', async () => {
            await masterFetch('/api/master/simulate-bo', { method: 'POST', body: JSON.stringify({}) });
            await Promise.all([loadOverviewAndIntegrity(), loadAuditFeed(), loadDatabaseInspector()]);
        });
    }
    // Botao Atualizar
    const refBtn = document.getElementById('btn-refresh-master');
    if (refBtn) {
        refBtn.addEventListener('click', () => refreshAllMasterData());
    }
    refreshAllMasterData();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMasterUI, { once: true });
}
else {
    initMasterUI();
}
