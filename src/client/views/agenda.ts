import { api, errorMessage, query } from '../api.js';
import { openAppointmentDetails, openAppointmentForm } from '../appointments-ui.js';
import {
  type AgendaMode,
  type AppointmentFilters,
  content,
  loadCatalog,
  optionsFrom,
  refresh,
  ROW_HEIGHT,
  ROW_MINUTES,
  state,
  statusOptions,
} from '../panel-context.js';
import type {
  Appointment,
  Barber,
} from '../types.js';
import {
  addDays,
  debounce,
  emptyBlock,
  esc,
  formatDateBR,
  formatPhone,
  hhmmToMinutes,
  hydrateLottieElements,
  icon,
  minutesToHHMM,
  money,
  skeletonTable,
  startOfWeek,
  statusPill,
  toast,
  todayISO,
  weekdayOfISO,
  WEEKDAYS_SHORT,
} from '../ui.js';

function weekDates(iso: string): string[] {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}
/* --------------------------------- Agenda -------------------------------- */

interface CalendarPlacedItem extends Appointment {
  startMin: number;
  endMin: number;
  lane: number;
}

function computeRange(barbers: Barber[], weekdays: number[]): { start: number; end: number } {
  let start = 24 * 60;
  let end = 0;
  for (const barber of barbers) {
    for (const day of barber.hours || []) {
      if (!Number(day.is_working) || !weekdays.includes(Number(day.weekday))) continue;
      start = Math.min(start, hhmmToMinutes(day.start_time));
      end = Math.max(end, hhmmToMinutes(day.end_time));
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    start = 8 * 60;
    end = 20 * 60;
  }
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

function layoutLanes(
  items: Array<Appointment & { startMin: number; endMin: number }>
): { placed: CalendarPlacedItem[]; lanes: number } {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds: number[] = [];
  const placed: CalendarPlacedItem[] = sorted.map((item) => {
    let lane = laneEnds.findIndex((value) => value <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    return { ...item, lane };
  });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

function blockHtml(
  item: CalendarPlacedItem,
  rangeStart: number,
  laneCount: number,
  compact: boolean
): string {
  const offset = ((item.startMin - rangeStart) / ROW_MINUTES) * ROW_HEIGHT;
  const height = ((item.endMin - item.startMin) / ROW_MINUTES) * ROW_HEIGHT;
  const widthPct = 100 / laneCount;
  const leftPct = item.lane * widthPct;
  const title = compact ? `${item.start_time} ${item.client_name}` : `${item.client_name}`;
  const sub = compact
    ? `${item.barber_name}`
    : `${item.start_time}-${item.end_time} — ${item.service_name || 'Serviço'}`;
  return `
    <div class="appt-block status-${esc(item.status)}${compact ? ' compact' : ''}" data-appt="${item.id}"
         style="top:${offset + 2}px;height:${Math.max(22, height - 4)}px;left:calc(${leftPct}% + 3px);width:calc(${widthPct}% - 6px);right:auto">
      <strong>${esc(title)}</strong>
      <span>${esc(sub)}</span>
    </div>`;
}

export async function viewAgenda(): Promise<void> {
  await loadCatalog();

  const toolbar = `
    <div class="toolbar">
      <div class="segmented" id="mode-switch">
        <button type="button" data-mode="day" class="${state.mode === 'day' ? 'active' : ''}">Dia</button>
        <button type="button" data-mode="week" class="${state.mode === 'week' ? 'active' : ''}">Semana</button>
      </div>
      <button class="icon-btn" id="agenda-prev" type="button" aria-label="Anterior">${icon('left')}</button>
      <button class="btn" id="agenda-today" type="button">Hoje</button>
      <button class="icon-btn" id="agenda-next" type="button" aria-label="Próximo">${icon('right')}</button>
      <input class="control" type="date" id="agenda-date" value="${esc(state.date)}" />
      <span class="grow"></span>
      <select class="control" id="agenda-barber">
        <option value="">Todos os profissionais</option>
        ${optionsFrom(
          state.catalog.barbers.filter((barber) => Number(barber.active)),
          state.barberFilter,
          (barber) => barber.name
        )}
      </select>
      <button class="btn btn-primary" id="agenda-new" type="button">${icon('plus')} Novo agendamento</button>
    </div>
    <div id="calendar-holder">${skeletonTable(6)}</div>
    <div class="legend" style="margin-top:16px">
      <span><i style="background:#d9a441"></i>Aguardando</span>
      <span><i style="background:#43b581"></i>Confirmado</span>
      <span><i style="background:#5b8def"></i>Concluído</span>
      <span><i style="background:rgba(255,255,255,.25)"></i>Cancelado / Não compareceu</span>
      <span><i style="background:var(--gold)"></i>Clique em um horário livre para agendar</span>
    </div>`;

  content().innerHTML = toolbar;
  const holder = document.getElementById('calendar-holder');
  if (!holder) return;

  const shift = (days: number): void => {
    state.date = addDays(state.date, state.mode === 'day' ? days : days * 7);
    void refresh();
  };

  document.querySelectorAll<HTMLElement>('#mode-switch button').forEach((element) =>
    element.addEventListener('click', () => {
      state.mode = (element.dataset.mode as AgendaMode | undefined) || 'day';
      void refresh();
    })
  );
  document.getElementById('agenda-prev')?.addEventListener('click', () => shift(-1));
  document.getElementById('agenda-next')?.addEventListener('click', () => shift(1));
  document.getElementById('agenda-today')?.addEventListener('click', () => {
    state.date = todayISO();
    void refresh();
  });
  const agendaDateInput = document.getElementById('agenda-date') as HTMLInputElement | null;
  agendaDateInput?.addEventListener('change', () => {
    if (agendaDateInput.value) {
      state.date = agendaDateInput.value;
      void refresh();
    }
  });
  const agendaBarberSelect = document.getElementById('agenda-barber') as HTMLSelectElement | null;
  agendaBarberSelect?.addEventListener('change', () => {
    state.barberFilter = agendaBarberSelect.value;
    void renderCalendar(holder);
  });
  document.getElementById('agenda-new')?.addEventListener('click', () => {
    void openAppointmentForm({
      defaults: { date: state.date },
      onSaved: () => {
        void refresh();
      },
    });
  });

  await renderCalendar(holder);
}

async function renderCalendar(holder: HTMLElement): Promise<void> {
  const barbers = state.catalog.barbers.filter((barber) => Number(barber.active));
  if (!barbers.length) {
    holder.innerHTML = emptyBlock(
      'Nenhum profissional ativo',
      'Cadastre um profissional com horário de trabalho para liberar a agenda.'
    );
    hydrateLottieElements(holder);
    return;
  }

  const days = state.mode === 'week' ? weekDates(state.date) : [state.date];
  const fromDay = days[0] ?? state.date;
  const toDay = days[days.length - 1] ?? state.date;
  const appointments = await api.get<Appointment[]>(
    `/api/appointments${query({
      from: fromDay,
      to: toDay,
      barber_id: state.barberFilter || undefined,
    })}`
  );

  const barberOptions = state.barberFilter
    ? barbers.filter((barber) => String(barber.id) === String(state.barberFilter))
    : barbers;
  const weekdays = [...new Set(days.map(weekdayOfISO))];
  const { start: rangeStart, end: rangeEnd } = computeRange(barberOptions, weekdays);
  const rows = Math.max(1, Math.round((rangeEnd - rangeStart) / ROW_MINUTES));

  const isDayMode = state.mode === 'day';
  const colCount = isDayMode ? barberOptions.length : days.length;
  const gridTemplate = `grid-template-columns:64px repeat(${Math.max(1, colCount)}, minmax(140px, 1fr))`;

  const headCells = !isDayMode
    ? days
        .map((iso) => {
          const isToday = iso === todayISO();
          return `<div class="cal-col${isToday ? ' today' : ''}">${esc(WEEKDAYS_SHORT[weekdayOfISO(iso)] ?? '')}<small>${esc(formatDateBR(iso))}</small></div>`;
        })
        .join('')
    : barberOptions
        .map((barber) => {
          const count = appointments.filter((item) => Number(item.barber_id) === Number(barber.id)).length;
          return `<div class="cal-col">${esc(barber.name)}<small>${count} agendamento(s)</small></div>`;
        })
        .join('');

  const timeColumn = Array.from({ length: rows }, (_, index) => {
    const minutes = rangeStart + index * ROW_MINUTES;
    return `<div class="time-slot">${minutesToHHMM(minutes)}</div>`;
  }).join('');

  const bodyColumns = isDayMode
    ? barberOptions
        .map((barber) => {
          const items = appointments
            .filter((item) => Number(item.barber_id) === Number(barber.id))
            .map((item) => ({
              ...item,
              startMin: hhmmToMinutes(item.start_time),
              endMin: hhmmToMinutes(item.end_time) || hhmmToMinutes(item.start_time) + 30,
            }));
          const { placed, lanes } = layoutLanes(items);
          const blocks = placed.map((item) => blockHtml(item, rangeStart, lanes, false)).join('');
          const slots = Array.from({ length: rows }, (_, index) => {
            const minutes = rangeStart + index * ROW_MINUTES;
            return `<div class="slot-row" data-time="${minutesToHHMM(minutes)}" data-date="${esc(state.date)}" data-barber="${barber.id}"></div>`;
          }).join('');
          return `<div class="barber-col">${slots}${blocks}</div>`;
        })
        .join('')
    : days
        .map((dayIso) => {
          const items = appointments
            .filter((item) => item.date === dayIso)
            .map((item) => ({
              ...item,
              startMin: hhmmToMinutes(item.start_time),
              endMin: hhmmToMinutes(item.end_time) || hhmmToMinutes(item.start_time) + 30,
            }));
          const { placed, lanes } = layoutLanes(items);
          const blocks = placed.map((item) => blockHtml(item, rangeStart, lanes, true)).join('');
          const slots = Array.from({ length: rows }, (_, index) => {
            const minutes = rangeStart + index * ROW_MINUTES;
            return `<div class="slot-row" data-time="${minutesToHHMM(minutes)}" data-date="${esc(dayIso)}" data-barber="${esc(state.barberFilter || '')}"></div>`;
          }).join('');
          return `<div class="day-col">${slots}${blocks}</div>`;
        })
        .join('');

  holder.innerHTML = `
    <div class="calendar">
      <div class="calendar-head" style="${gridTemplate}">
        <div class="cal-corner"></div>
        ${headCells}
      </div>
      <div class="calendar-body" style="${gridTemplate}">
        <div class="time-col">${timeColumn}</div>
        ${bodyColumns}
      </div>
    </div>`;

  holder.querySelectorAll<HTMLElement>('.slot-row').forEach((element) =>
    element.addEventListener('click', () => {
      const defaults: { date?: string; start_time?: string; barber_id?: number } = {
        date: element.dataset.date,
        start_time: element.dataset.time,
      };
      if (element.dataset.barber) defaults.barber_id = Number(element.dataset.barber);
      void openAppointmentForm({
        defaults,
        onSaved: () => {
          void refresh();
        },
      });
    })
  );

  holder.querySelectorAll<HTMLElement>('[data-appt]').forEach((element) =>
    element.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      void (async () => {
        try {
          const appointment = await api.get<Appointment>(`/api/appointments/${element.dataset.appt}`);
          openAppointmentDetails(appointment, {
            onChanged: () => {
              void refresh();
            },
          });
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    })
  );
}

/* ------------------------------ Agendamentos ------------------------------ */

function defaultAppointmentFilters(): AppointmentFilters {
  return {
    from: todayISO(),
    to: addDays(todayISO(), 30),
    status: '',
    barber_id: '',
    search: '',
  };
}

export async function viewAppointments(): Promise<void> {
  await loadCatalog();
  const filters = state.appointmentFilters ?? (state.appointmentFilters = defaultAppointmentFilters());

  content().innerHTML = `
    <div class="toolbar">
      <div class="search-input">
        ${icon('search')}
        <input id="af-search" placeholder="Buscar cliente, telefone ou serviço" value="${esc(filters.search)}" />
      </div>
      <input class="control" type="date" id="af-from" value="${esc(filters.from)}" />
      <input class="control" type="date" id="af-to" value="${esc(filters.to)}" />
      <select class="control" id="af-status">
        <option value="">Todos os status</option>
        ${statusOptions(filters.status)}
      </select>
      <select class="control" id="af-barber">
        <option value="">Todos os profissionais</option>
        ${optionsFrom(state.catalog.barbers, filters.barber_id, (barber) => barber.name)}
      </select>
      <span class="grow"></span>
      <button class="btn btn-sm" id="af-clear" type="button">Limpar</button>
      <button class="btn btn-primary" id="af-new" type="button">${icon('plus')} Novo agendamento</button>
    </div>
    <div id="appointments-holder">${skeletonTable(6)}</div>`;

  const search = debounce(() => void loadAppointmentList(), 340);
  const searchInput = document.getElementById('af-search') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    filters.search = searchInput.value.trim();
    search();
  });
  ['af-from', 'af-to', 'af-status', 'af-barber'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      filters.from = (document.getElementById('af-from') as HTMLInputElement | null)?.value ?? '';
      filters.to = (document.getElementById('af-to') as HTMLInputElement | null)?.value ?? '';
      filters.status = (document.getElementById('af-status') as HTMLSelectElement | null)?.value ?? '';
      filters.barber_id = (document.getElementById('af-barber') as HTMLSelectElement | null)?.value ?? '';
      void loadAppointmentList();
    });
  });
  document.getElementById('af-clear')?.addEventListener('click', () => {
    state.appointmentFilters = defaultAppointmentFilters();
    void refresh();
  });
  document.getElementById('af-new')?.addEventListener('click', () => {
    void openAppointmentForm({
      defaults: { date: todayISO() },
      onSaved: () => {
        void loadAppointmentList();
      },
    });
  });

  await loadAppointmentList();
}

async function loadAppointmentList(): Promise<void> {
  const holder = document.getElementById('appointments-holder');
  if (!holder) return;
  const filters = state.appointmentFilters ?? defaultAppointmentFilters();
  holder.innerHTML = skeletonTable(6);

  let rows: Appointment[];
  try {
    rows = await api.get<Appointment[]>(
      `/api/appointments${query({
        from: filters.from,
        to: filters.to,
        status: filters.status,
        barber_id: filters.barber_id,
        search: filters.search,
      })}`
    );
  } catch (error: unknown) {
    holder.innerHTML = emptyBlock('Erro ao buscar agendamentos', errorMessage(error));
    hydrateLottieElements(holder);
    return;
  }

  if (!rows.length) {
    holder.innerHTML = `<div class="table-wrap">${emptyBlock(
      'Nenhum agendamento encontrado',
      'Ajuste os filtros ou crie um novo agendamento.'
    )}</div>`;
    hydrateLottieElements(holder);
    return;
  }

  holder.innerHTML = `
    <p class="muted" style="margin-bottom:12px">${rows.length} agendamento(s) encontrado(s).</p>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Data</th><th>Hora</th><th>Cliente</th><th>Serviço</th>
            <th>Profissional</th><th>Valor</th><th>Status</th><th class="actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (item) => `
            <tr>
              <td class="mono">${esc(formatDateBR(item.date))}<div class="cell-sub">${esc(WEEKDAYS_SHORT[weekdayOfISO(item.date)] ?? '')}</div></td>
              <td class="mono">${esc(item.start_time)}<div class="cell-sub">${esc(item.end_time)}</div></td>
              <td class="cell-strong">${esc(item.client_name)}<div class="cell-sub">${esc(formatPhone(item.client_phone))}</div></td>
              <td>${esc(item.service_name || '-')}</td>
              <td>${esc(item.barber_name)}</td>
              <td class="mono">${esc(money(item.price))}</td>
              <td>${statusPill(item.status)}</td>
              <td class="actions">
                <div class="row-actions" style="justify-content:flex-end">
                  ${
                    item.status === 'pending'
                      ? `<button class="btn btn-ok btn-sm" data-confirm="${item.id}" type="button">${icon('check')} Confirmar</button>`
                      : ''
                  }
                  <button class="btn btn-sm" data-details="${item.id}" type="button">${icon('edit')} Detalhes</button>
                </div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  const openDetails = async (id: string | undefined): Promise<void> => {
    if (!id) return;
    try {
      const appointment = await api.get<Appointment>(`/api/appointments/${id}`);
      openAppointmentDetails(appointment, {
        onChanged: () => {
          void loadAppointmentList();
        },
      });
    } catch (error: unknown) {
      toast(errorMessage(error), 'error');
    }
  };

  holder.querySelectorAll<HTMLElement>('[data-details]').forEach((element) =>
    element.addEventListener('click', () => void openDetails(element.dataset.details))
  );
  holder.querySelectorAll<HTMLElement>('[data-confirm]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        try {
          await api.patch(`/api/appointments/${element.dataset.confirm}/status`, { status: 'confirmed' });
          toast('Agendamento confirmado.');
          await loadAppointmentList();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    })
  );
}

