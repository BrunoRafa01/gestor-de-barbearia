import {
  animateChartsAndBars,
  animateNumbers,
} from '../../animations/index.js';
import { api, errorMessage, query } from '../api.js';
import {
  content,
  kpi,
  loadCatalog,
  optionsFrom,
  refresh,
  type ReportFilters,
  state,
} from '../panel-context.js';
import type {
  ReportResponse,
} from '../types.js';
import {
  addDays,
  emptyBlock,
  esc,
  formatDateBR,
  hydrateLottieElements,
  icon,
  initials,
  money,
  skeletonTable,
  spinnerBlock,
  statusPill,
  toast,
  todayISO,
} from '../ui.js';


/* -------------------------------- Relatórios ------------------------------ */

function barRow(label: string, total: number, max: number, formatValue: (val: number) => string): string {
  const width = max > 0 ? Math.max(2, Math.round((total / max) * 100)) : 0;
  return `
    <div class="bar-row">
      <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
      <span class="bar-value mono">${formatValue(total)}</span>
    </div>`;
}

function statusTable(byStatus: ReportResponse['by_status']): string {
  if (!byStatus.length) return emptyBlock('Nenhum agendamento no período');
  const rows = byStatus
    .slice()
    .sort((a, b) => b.total - a.total)
    .map(
      (row) =>
        `<tr><td>${statusPill(row.status)}</td><td class="mono">${row.total}</td><td class="mono">${esc(money(row.revenue))}</td></tr>`
    )
    .join('');
  return `<table class="data" style="min-width:0"><thead><tr><th>Situação</th><th>Total</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export async function viewReports(): Promise<void> {
  await loadCatalog();

  const initial: ReportFilters = state.reportFilters ?? {
    from: `${todayISO().slice(0, 7)}-01`,
    to: todayISO(),
    barber_id: '',
  };
  state.reportFilters = initial;

  const toolbar = `
    <div class="toolbar">
      <div class="segmented" id="report-range">
        <button type="button" data-range="7">7 dias</button>
        <button type="button" data-range="30">30 dias</button>
        <button type="button" data-range="month">Este mês</button>
      </div>
      <input class="control" type="date" id="report-from" value="${esc(initial.from)}" />
      <span class="faint">até</span>
      <input class="control" type="date" id="report-to" value="${esc(initial.to)}" />
      <select class="control" id="report-barber">
        <option value="">Todos os profissionais</option>
        ${optionsFrom(state.catalog.barbers, initial.barber_id, (barber) => barber.name)}
      </select>
      <span class="grow"></span>
      <button class="btn btn-ghost" id="report-export-csv" type="button">${icon('clipboard')} Exportar CSV</button>
      <button class="btn btn-primary" id="report-refresh" type="button">${icon('chart')} Atualizar</button>
    </div>
    <div id="report-body">${skeletonTable(5)}</div>`;

  content().innerHTML = toolbar;
  const body = document.getElementById('report-body');
  if (!body) return;

  document.querySelectorAll<HTMLElement>('#report-range button').forEach((element) =>
    element.addEventListener('click', () => {
      const range = element.dataset.range;
      const base = state.reportFilters ?? initial;
      state.reportFilters =
        range === 'month'
          ? { ...base, from: `${todayISO().slice(0, 7)}-01`, to: todayISO() }
          : { ...base, from: addDays(todayISO(), -(Number(range) - 1)), to: todayISO() };
      void refresh();
    })
  );

  document.getElementById('report-refresh')?.addEventListener('click', () => {
    state.reportFilters = {
      from:
        (document.getElementById('report-from') as HTMLInputElement | null)?.value ||
        `${todayISO().slice(0, 7)}-01`,
      to: (document.getElementById('report-to') as HTMLInputElement | null)?.value || todayISO(),
      barber_id: (document.getElementById('report-barber') as HTMLSelectElement | null)?.value ?? '',
    };
    void loadReport(body);
  });

  document.getElementById('report-export-csv')?.addEventListener('click', () => {
    void (async () => {
      try {
        const filters = state.reportFilters ?? {
          from: `${todayISO().slice(0, 7)}-01`,
          to: todayISO(),
          barber_id: '',
        };
        const report = await api.get<ReportResponse>(
          `/api/reports${query({ from: filters.from, to: filters.to, barber_id: filters.barber_id })}`
        );
        const rows = [
          ['Profissional', 'Total Atendimentos', 'Concluidos', 'Receita Realizada (R$)', 'Comissao (R$)'],
          ...report.by_barber.map((b) => [
            b.name,
            b.total,
            b.completed,
            Number(b.realized).toFixed(2),
            Number(b.commission_value).toFixed(2),
          ]),
        ];
        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(';')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `relatorio-financeiro-${filters.from}-a-${filters.to}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast('Relatório exportado em CSV com sucesso!', 'ok');
      } catch (err: unknown) {
        toast(`Erro ao exportar: ${errorMessage(err)}`, 'error');
      }
    })();
  });

  await loadReport(body);
}

async function loadReport(body: HTMLElement): Promise<void> {
  const filters = state.reportFilters ?? {
    from: `${todayISO().slice(0, 7)}-01`,
    to: todayISO(),
    barber_id: '',
  };
  body.innerHTML = spinnerBlock('Calculando relatórios...');
  hydrateLottieElements(body);

  let report: ReportResponse;
  try {
    report = await api.get<ReportResponse>(
      `/api/reports${query({ from: filters.from, to: filters.to, barber_id: filters.barber_id })}`
    );
  } catch (error: unknown) {
    body.innerHTML = emptyBlock('Não foi possível gerar o relatório', errorMessage(error));
    hydrateLottieElements(body);
    return;
  }

  const { totals, range } = report;
  const percent = (value: number): string => `${Math.round(Number(value) * 100)}%`;

  const dailyMax = Math.max(1, ...report.daily.map((day) => day.revenue));
  const weekdayMax = Math.max(1, ...report.by_weekday.map((day) => day.total));
  const serviceMax = Math.max(1, ...report.by_service.map((item) => item.total));

  const dailyBars = report.daily.length
    ? report.daily
        .slice(-31)
        .map((day) => barRow(formatDateBR(day.date), day.revenue, dailyMax, (value) => esc(money(value))))
        .join('')
    : emptyBlock('Sem faturamento registrado no período');

  const weekdayBars = report.by_weekday
    .map((day) => barRow(day.label, day.total, weekdayMax, (value) => String(value)))
    .join('');

  const serviceRows = report.by_service.length
    ? report.by_service
        .map(
          (item) =>
            `<tr><td class="cell-strong">${esc(item.name)}</td><td class="mono">${item.total}</td><td class="mono">${esc(money(item.revenue))}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="3"><div class="empty">Nenhum atendimento no período.</div></td></tr>`;

  const barberRows = report.by_barber.length
    ? report.by_barber
        .map(
          (item) => `
          <tr>
            <td class="cell-strong">${esc(item.name)}<div class="cell-sub">${item.commission_percent}% de comissão</div></td>
            <td class="mono">${item.total}</td>
            <td class="mono">${item.completed}</td>
            <td class="mono">${esc(money(item.realized))}</td>
            <td class="mono gold">${esc(money(item.commission_value))}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="5"><div class="empty">Nenhum atendimento no período.</div></td></tr>`;

  const totalCommissions = report.by_barber.reduce((sum, b) => sum + Number(b.commission_value || 0), 0);
  const netHouse = Math.max(0, Number(totals.revenue_realized || 0) - totalCommissions);

  const barberCards = report.by_barber.length
    ? report.by_barber
        .map(
          (item) => `
          <div class="barber-repasse-card">
            <div class="barber-repasse-head">
              <div class="barber-repasse-id">
                <div class="avatar">${esc(initials(item.name))}</div>
                <div>
                  <div style="font-weight:600;color:#DEE2F0">${esc(item.name)}</div>
                  <div style="font-size:11.5px;color:#4CD7F6">${item.completed} concluído(s)</div>
                </div>
              </div>
              <span class="barber-repasse-badge">${item.commission_percent}% Comissão</span>
            </div>
            <div class="barber-repasse-metrics">
              <div>
                <span>Faturamento Bruto</span>
                <strong>${esc(money(item.realized))}</strong>
              </div>
              <div>
                <span>Comissão Total</span>
                <strong class="text-blue-accent">${esc(money(item.commission_value))}</strong>
              </div>
            </div>
            <div class="barber-repasse-foot">
              <span>${item.total} atendimento(s) no período</span>
              <span class="text-emerald-accent">Repasse calculado</span>
            </div>
          </div>`
        )
        .join('')
    : emptyBlock('Nenhum profissional com atendimentos no período');

  body.innerHTML = `
    <div class="grid grid-kpi">
      ${kpi({ label: 'Receita Realizada', value: esc(money(totals.revenue_realized)), small: true, iconName: 'wallet', foot: `${totals.completed} atendimento(s) concluído(s)` })}
      <div class="stitch-kpi-cyan">${kpi({ label: 'Receita Prevista', value: esc(money(totals.revenue_expected)), small: true, iconName: 'chart', foot: `${totals.appointments} agendamento(s) ativos` })}</div>
      <div class="stitch-kpi-blue">${kpi({ label: 'Comissões a Pagar', value: esc(money(totalCommissions)), small: true, iconName: 'users', foot: 'Repasse total da equipe' })}</div>
      <div class="stitch-kpi-emerald">${kpi({ label: 'Saldo Líquido da Casa', value: esc(money(netHouse)), small: true, iconName: 'sparkles', foot: 'Receita livre de comissões' })}</div>
    </div>

    <div class="grid grid-kpi" style="margin-top:14px">
      ${kpi({ label: 'Ticket médio', value: esc(money(totals.average_ticket)), small: true, foot: 'Por atendimento concluído' })}
      ${kpi({ label: 'Taxa de conclusão', value: percent(totals.completion_rate), foot: `${totals.completed} de ${totals.appointments}` })}
      ${kpi({ label: 'Taxa de cancelamento', value: percent(totals.cancellation_rate), foot: `${totals.cancelled} cancelado(s)` })}
      ${kpi({ label: 'Novos clientes', value: totals.new_clients, foot: `${totals.no_show} falta(s) no período` })}
    </div>

    <div style="margin-top:20px">
      <div class="card-header" style="margin-bottom:12px">
        <h2>Repasse por Barbeiro &amp; Performance Individual</h2>
        <span class="spacer"></span>
        <span class="card-sub">Taxas individuais calculadas sobre receita realizada</span>
      </div>
      <div class="grid grid-3">${barberCards}</div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header">
          <h2>Faturamento por dia</h2>
          <span class="spacer"></span>
          <span class="card-sub">${esc(formatDateBR(range.from))} — ${esc(formatDateBR(range.to))}</span>
        </div>
        <div class="bars">${dailyBars}</div>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Movimento por dia da semana</h2>
          <span class="spacer"></span>
          <span class="card-sub">Atendimentos</span>
        </div>
        <div class="bars">${weekdayBars}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <h2>Desempenho por profissional</h2>
        <span class="spacer"></span>
        <span class="card-sub">Comissão calculada sobre a receita realizada</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Profissional</th><th>Total</th><th>Concluídos</th><th>Receita</th><th>Comissão</th></tr></thead>
          <tbody>${barberRows}</tbody>
        </table>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><h2>Serviços mais procurados</h2></div>
        <div class="bars">${
          report.by_service.length
            ? report.by_service
                .map((item) => barRow(item.name, item.total, serviceMax, (value) => String(value)))
                .join('')
            : ''
        }</div>
        <div class="table-wrap" style="margin-top:14px">
          <table class="data" style="min-width:0">
            <thead><tr><th>Serviço</th><th>Total</th><th>Receita</th></tr></thead>
            <tbody>${serviceRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h2>Agendamentos por situação</h2></div>
        <div class="table-wrap">${statusTable(report.by_status)}</div>
      </div>
    </div>

    <p class="faint" style="margin-top:16px;font-size:11.5px">
      Relatório gerado em ${esc(new Date(report.generated_at).toLocaleString('pt-BR'))}.
    </p>`;

  hydrateLottieElements(body);
  animateNumbers(body);
  animateChartsAndBars(body);
}

