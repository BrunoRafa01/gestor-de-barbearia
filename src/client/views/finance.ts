import { api, errorMessage } from '../api.js';
import {
  content,
} from '../panel-context.js';
import type {
  FinanceSummaryResponse,
} from '../types.js';
import {
  addDays,
  confirmDialog,
  esc,
  formatDateBR,
  money,
  readForm,
  skeletonTable,
  toast,
  todayISO,
} from '../ui.js';


/* -------------------------------- Financeiro ------------------------------ */

let financePreset = '30d';
let financeRange = { from: addDays(todayISO(), -29), to: todayISO() };

export async function viewFinance(): Promise<void> {
  const qs = `?from=${encodeURIComponent(financeRange.from)}&to=${encodeURIComponent(financeRange.to)}`;
  const data = await api.get<FinanceSummaryResponse>(`/api/finance/summary${qs}`);
  const summary = data.summary;
  const byMethod = data.by_payment_method || [];
  const closing = data.cash_closing || [];
  const expenses = data.expenses || [];
  const revRealized = Number(summary?.revenue_realized || 0);
  const netProfit = Number(summary?.net_profit || 0);
  const profitMargin = revRealized > 0 ? Math.round((netProfit / revRealized) * 100) : 0;
  const methodLabel: Record<string, string> = {
    pix: 'PIX',
    credit_card: 'Cartão de Crédito',
    debit_card: 'Cartão de Débito',
    cash: 'Dinheiro',
    other: 'Outro',
  };

  content().innerHTML = `
    <div class="stack" style="gap:22px">
      <div class="ct-header is-sticky">
        <div class="ct-segmented" role="tablist" aria-label="Período financeiro">
          ${(
            [
              ['today', 'Hoje'],
              ['7d', '7 dias'],
              ['30d', '30 dias'],
              ['month', 'Mês atual'],
            ] as const
          )
            .map(
              ([key, lbl]) =>
                `<button type="button" class="ct-seg-btn ${financePreset === key ? 'active' : ''}" data-fin-preset="${key}">${lbl}</button>`
            )
            .join('')}
        </div>
        <form id="fin-range-form" class="row-actions" style="gap:8px;flex-wrap:wrap">
          <input class="control" type="date" id="fin-from" value="${esc(financeRange.from)}" />
          <span class="muted">até</span>
          <input class="control" type="date" id="fin-to" value="${esc(financeRange.to)}" />
          <button type="submit" class="btn btn-primary btn-sm">Filtrar</button>
        </form>
      </div>

      <section class="ct-kpi-grid" aria-label="Resumo financeiro">
        <article class="ct-card">
          <div class="ct-card-head">
            <div>
              <div class="ct-card-label">Receita Bruta Realizada</div>
              <div class="ct-card-sub">Atendimentos concluídos</div>
            </div>
            <span class="ct-pill is-blue">${Number(summary?.completed_count || 0)} atend.</span>
          </div>
          <div class="ct-kpi-val mono">${esc(money(revRealized))}</div>
          <div class="ct-kpi-foot"><span>Previsto: <strong class="mono">${esc(money(summary?.revenue_expected || 0))}</strong></span></div>
        </article>

        <article class="ct-card">
          <div class="ct-card-head">
            <div>
              <div class="ct-card-label">Comissões da Equipe</div>
              <div class="ct-card-sub">Calculado por profissional</div>
            </div>
            <span class="ct-pill is-muted">Repasse</span>
          </div>
          <div class="ct-kpi-val mono">${esc(money(summary?.total_commissions || 0))}</div>
          <div class="ct-kpi-foot"><span>Sobre atendimentos concluídos</span></div>
        </article>

        <article class="ct-card">
          <div class="ct-card-head">
            <div>
              <div class="ct-card-label">Despesas Operacionais</div>
              <div class="ct-card-sub">Custos fixos e variáveis</div>
            </div>
            <span class="ct-pill">${expenses.length} lanç.</span>
          </div>
          <div class="ct-kpi-val mono">${esc(money(summary?.total_expenses || 0))}</div>
          <div class="ct-kpi-foot"><span>Total no período</span></div>
        </article>

        <article class="ct-card ct-card-accent">
          <div class="ct-card-head">
            <div>
              <div class="ct-card-label">Lucro Líquido Real</div>
              <div class="ct-card-sub">Receita − Comissões − Despesas</div>
            </div>
            <span class="ct-pill ${netProfit < 0 ? 'is-warn' : 'is-blue'}">${netProfit < 0 ? 'Prejuízo' : `${profitMargin}% margem`}</span>
          </div>
          <div class="ct-kpi-val mono">${esc(money(netProfit))}</div>
          <div class="ct-kpi-foot"><span>Resultado líquido do período</span></div>
        </article>
      </section>

      <div class="grid-2" style="gap:16px">
        <div class="card">
          <div class="card-header"><strong>Formas de Pagamento</strong><span class="muted">Atendimentos concluídos</span></div>
          <div class="card-body">
            ${
              byMethod.length
                ? `<div class="table-wrap"><table><thead><tr><th>Forma</th><th>Qtd</th><th>Total</th></tr></thead><tbody>
                    ${byMethod
                      .map(
                        (row) => `<tr>
                          <td>${esc(methodLabel[row.payment_method] || row.payment_method)}</td>
                          <td>${Number(row.count)}</td>
                          <td><strong>${esc(money(row.total))}</strong></td>
                        </tr>`
                      )
                      .join('')}
                  </tbody></table></div>`
                : '<p class="muted">Nenhum atendimento concluído no período.</p>'
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header"><strong>Lançar Despesa</strong><span class="muted">Registro operacional</span></div>
          <div class="card-body">
            <form id="fin-expense-form" class="form-grid">
              <div class="field span-2">
                <label for="exp-desc">Descrição</label>
                <input id="exp-desc" name="description" required maxlength="140" placeholder="Ex.: Aluguel, Energia, Pomadas..." />
              </div>
              <div class="field">
                <label for="exp-cat">Categoria</label>
                <select id="exp-cat" name="category">
                  <option value="Operacional">Operacional</option>
                  <option value="Produtos">Produtos</option>
                  <option value="Aluguel">Aluguel</option>
                  <option value="Energia/Água">Energia/Água</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
              <div class="field">
                <label for="exp-amount">Valor (R$)</label>
                <input id="exp-amount" name="amount" type="number" step="0.01" min="0.01" required placeholder="0,00" />
              </div>
              <div class="field">
                <label for="exp-date">Data</label>
                <input id="exp-date" name="date" type="date" value="${esc(todayISO())}" required />
              </div>
              <div class="field">
                <label for="exp-method">Pagamento</label>
                <select id="exp-method" name="payment_method">
                  <option value="pix">PIX</option>
                  <option value="cash">Dinheiro</option>
                  <option value="debit_card">Cartão Débito</option>
                  <option value="credit_card">Cartão Crédito</option>
                  <option value="other">Outro</option>
                </select>
              </div>
              <div class="field" style="grid-column:1 / -1;display:flex;align-items:flex-end;justify-content:flex-end;margin-top:4px">
                <button type="submit" class="btn btn-primary">Registrar Despesa</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><strong>Fechamento de Caixa Diário</strong><span class="muted">Receita, despesas e saldo</span></div>
        <div class="card-body">
          ${
            closing.length
              ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Receita</th><th>Despesas</th><th>Saldo</th></tr></thead><tbody>
                  ${closing
                    .map(
                      (row) => `<tr>
                        <td>${esc(formatDateBR(row.date))}</td>
                        <td>${esc(money(row.revenue))}</td>
                        <td>${esc(money(row.expenses))}</td>
                        <td><strong>${esc(money(row.net))}</strong></td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
              : '<p class="muted">Sem movimentação financeira no período.</p>'
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><strong>Histórico de Despesas</strong><span class="muted">${expenses.length} lançamento(s)</span></div>
        <div class="card-body">
          ${
            expenses.length
              ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th>Valor</th><th></th></tr></thead><tbody>
                  ${expenses
                    .map(
                      (exp) => `<tr>
                        <td>${esc(formatDateBR(exp.date))}</td>
                        <td>${esc(exp.description)}</td>
                        <td><span class="tag">${esc(exp.category)}</span></td>
                        <td>${esc(methodLabel[exp.payment_method] || exp.payment_method)}</td>
                        <td><strong>${esc(money(exp.amount))}</strong></td>
                        <td><button type="button" class="btn btn-danger btn-sm" data-del-expense="${exp.id}">Excluir</button></td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
              : '<p class="muted">Nenhuma despesa registrada neste período.</p>'
          }
        </div>
      </div>
    </div>`;

  document.querySelectorAll<HTMLElement>('[data-fin-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void (async () => {
        const today = todayISO();
        const preset = btn.dataset.finPreset || '30d';
        financePreset = preset;
        if (preset === 'today') financeRange = { from: today, to: today };
        else if (preset === '7d') financeRange = { from: addDays(today, -6), to: today };
        else if (preset === '30d') financeRange = { from: addDays(today, -29), to: today };
        else if (preset === 'month') financeRange = { from: `${today.slice(0, 7)}-01`, to: today };
        content().innerHTML = skeletonTable(5);
        await viewFinance();
      })();
    });
  });

  document.getElementById('fin-range-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    void (async () => {
      financePreset = 'custom';
      financeRange = {
        from: (document.getElementById('fin-from') as HTMLInputElement | null)?.value || todayISO(),
        to: (document.getElementById('fin-to') as HTMLInputElement | null)?.value || todayISO(),
      };
      content().innerHTML = skeletonTable(5);
      await viewFinance();
    })();
  });

  document.getElementById('fin-expense-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    void (async () => {
      const form = e.currentTarget as HTMLFormElement;
      const formVals = readForm(form);
      const payload = {
        description: String(formVals['description'] ?? ''),
        category: String(formVals['category'] ?? 'Operacional'),
        amount: Number(formVals['amount'] ?? 0),
        date: String(formVals['date'] ?? todayISO()),
        payment_method: String(formVals['payment_method'] ?? 'pix'),
      };
      try {
        await api.post('/api/finance/expenses', payload);
        toast('Despesa registrada com sucesso.');
        await viewFinance();
      } catch (err: unknown) {
        toast(errorMessage(err, 'Erro ao registrar despesa.'), 'error');
      }
    })();
  });

  document.querySelectorAll<HTMLElement>('[data-del-expense]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void (async () => {
        const id = btn.dataset.delExpense;
        if (!id) return;
        const confirmed = await confirmDialog({
          title: 'Excluir esta despesa?',
          message: 'Esta ação remove o lançamento do fechamento de caixa.',
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.del(`/api/finance/expenses/${id}`);
          toast('Despesa removida.');
          await viewFinance();
        } catch (err: unknown) {
          toast(errorMessage(err, 'Erro ao excluir despesa.'), 'error');
        }
      })();
    });
  });
}

