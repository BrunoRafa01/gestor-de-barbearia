/**
 * Componentes compartilhados de agendamento: formulário e painel de detalhes — NOVA RUNTIME
 */

import { api, errorMessage, query } from './api.js';
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityResponse,
  Barber,
  Client,
  PaymentMethod,
  Service,
} from './types.js';
import {
  button,
  confirmDialog,
  esc,
  formatDateBR,
  formatPhone,
  icon,
  money,
  openModal,
  openWhatsapp,
  readForm,
  setBusy,
  statusPill,
  toast,
  todayISO,
} from './ui.js';

interface CatalogData {
  services: Service[];
  barbers: Barber[];
  clients: Client[];
}

async function loadCatalog(): Promise<CatalogData> {
  const [services, barbers, clients] = await Promise.all([
    api.get<Service[]>('/api/services?active=1'),
    api.get<Barber[]>('/api/barbers?active=1'),
    api.get<Client[]>('/api/clients'),
  ]);
  return { services, barbers, clients };
}

function options<T>(
  list: T[],
  selected: string | number | null | undefined,
  labelFn: (item: T) => string,
  valueFn: (item: T) => string | number = (item) => (item as unknown as { id: string | number }).id
): string {
  return list
    .map((item) => {
      const value = String(valueFn(item));
      const isSelected = String(selected ?? '') === value ? ' selected' : '';
      return `<option value="${esc(value)}"${isSelected}>${esc(labelFn(item))}</option>`;
    })
    .join('');
}

/** Cadastro rápido de cliente a partir do formulário de agendamento. */
function quickCreateClient(): Promise<Client | null> {
  return new Promise<Client | null>((resolve) => {
    let settled = false;
    const finish = (val: Client | null): void => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const modal = openModal({
      title: 'Novo cliente',
      narrow: true,
      body: `
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field">
            <label for="qc-name">Nome</label>
            <input id="qc-name" name="name" placeholder="Nome do cliente" />
          </div>
          <div class="field">
            <label for="qc-phone">WhatsApp</label>
            <input id="qc-phone" name="phone" placeholder="(11) 99999-9999" />
          </div>
        </div>`,
    });

    modal.setFooter([
      button(
        'Cancelar',
        () => {
          modal.close();
          finish(null);
        },
        'btn btn-ghost'
      ),
      button(
        `${icon('check')} Cadastrar`,
        async (event) => {
          const data = readForm(modal.body);
          const name = typeof data['name'] === 'string' ? data['name'] : '';
          const phone = typeof data['phone'] === 'string' ? data['phone'] : '';
          if (!name || !phone) {
            toast('Informe nome e WhatsApp.', 'error');
            return;
          }
          setBusy(event.currentTarget, true, 'Salvando...');
          try {
            const created = await api.post<Client>('/api/clients', { name, phone });
            modal.close();
            toast('Cliente cadastrado.');
            finish(created);
          } catch (error: unknown) {
            toast(errorMessage(error), 'error');
            setBusy(event.currentTarget, false);
          }
        },
        'btn btn-primary'
      ),
    ]);
    modal.onClose(() => finish(null));
  });
}

export interface AppointmentFormDefaults {
  client_id?: number;
  barber_id?: number;
  service_id?: number;
  date?: string;
  start_time?: string;
}

export interface OpenAppointmentFormOptions {
  appointment?: Appointment | null;
  defaults?: AppointmentFormDefaults;
  onSaved?: (() => void) | null;
}

export async function openAppointmentForm({
  appointment = null,
  defaults = {},
  onSaved = null,
}: OpenAppointmentFormOptions = {}): Promise<void> {
  const editing = Boolean(appointment?.id);
  let catalog: CatalogData;
  try {
    catalog = await loadCatalog();
  } catch (error: unknown) {
    toast(errorMessage(error), 'error');
    return;
  }

  const { services, barbers } = catalog;
  let clients = catalog.clients;

  const firstService = services[0];
  if (!firstService) {
    toast('Cadastre pelo menos um serviço antes de agendar.', 'error');
    return;
  }
  const firstBarber = barbers[0];
  if (!firstBarber) {
    toast('Cadastre pelo menos um profissional antes de agendar.', 'error');
    return;
  }

  const current = {
    client_id: appointment?.client_id ?? defaults.client_id ?? '',
    barber_id: appointment?.barber_id ?? defaults.barber_id ?? firstBarber.id,
    service_id: appointment?.service_id ?? defaults.service_id ?? firstService.id,
    date: appointment?.date ?? defaults.date ?? todayISO(),
    start_time: appointment?.start_time ?? defaults.start_time ?? '',
    status: appointment?.status ?? 'pending',
    payment_method: (appointment?.payment_method ?? 'pix') as PaymentMethod | string,
    notes: appointment?.notes ?? '',
  };

  const body = `
    <div class="form-grid">
      <div class="field span-2">
        <label for="ap-client">Cliente</label>
        <div style="display:flex;gap:8px">
          <select id="ap-client" name="client_id" style="flex:1">
            <option value="">Selecione o cliente</option>
            ${options(clients, current.client_id, (item) => `${item.name} - ${formatPhone(item.phone)}`)}
          </select>
          <button type="button" class="btn" id="ap-new-client">${icon('plus')} Novo</button>
        </div>
      </div>

      <div class="field">
        <label for="ap-service">Serviço</label>
        <select id="ap-service" name="service_id">
          ${options(services, current.service_id, (item) => `${item.name} - ${item.duration_min} min - ${money(item.price)}`)}
        </select>
      </div>

      <div class="field">
        <label for="ap-barber">Profissional</label>
        <select id="ap-barber" name="barber_id">
          ${options(barbers, current.barber_id, (item) => item.name)}
        </select>
      </div>

      <div class="field">
        <label for="ap-date">Data</label>
        <input type="date" id="ap-date" name="date" value="${esc(current.date)}" />
      </div>

      <div class="field">
        <label for="ap-time">Horário</label>
        <select id="ap-time" name="start_time">
          <option value="">Carregando...</option>
        </select>
        <span class="hint" id="ap-time-hint"></span>
      </div>

      <div class="field">
        <label for="ap-price">Valor (opcional)</label>
        <input type="number" step="0.01" min="0" id="ap-price" name="price" value="${
          appointment?.price ?? ''
        }" placeholder="Usa o preço do serviço" />
      </div>

      <div class="field">
        <label for="ap-payment">Forma de pagamento</label>
        <select id="ap-payment" name="payment_method">
          ${options(
            [
              { id: 'pix', name: 'PIX' },
              { id: 'credit_card', name: 'Cartão de Crédito' },
              { id: 'debit_card', name: 'Cartão de Débito' },
              { id: 'cash', name: 'Dinheiro' },
              { id: 'other', name: 'Outro' },
            ],
            current.payment_method,
            (item) => item.name
          )}
        </select>
      </div>

      ${
        editing
          ? `<div class="field">
               <label for="ap-status">Status</label>
               <select id="ap-status" name="status">
                 ${options(
                   [
                     { id: 'pending', name: 'Aguardando' },
                     { id: 'confirmed', name: 'Confirmado' },
                     { id: 'completed', name: 'Concluído' },
                     { id: 'cancelled', name: 'Cancelado' },
                     { id: 'no_show', name: 'Não compareceu' },
                   ],
                   current.status,
                   (item) => item.name
                 )}
               </select>
             </div>`
          : ''
      }

      <div class="field span-2">
        <label for="ap-notes">Observações</label>
        <textarea id="ap-notes" name="notes" placeholder="Preferências, alergias, observações...">${esc(current.notes || '')}</textarea>
      </div>

      <div class="field span-2" id="ap-error" style="display:none">
        <span class="hint" style="color:#f87171" id="ap-error-text"></span>
      </div>
    </div>`;

  const modal = openModal({
    title: editing ? 'Editar agendamento' : 'Novo agendamento',
    body,
  });

  const clientSelect = modal.body.querySelector<HTMLSelectElement>('#ap-client')!;
  const barberSelect = modal.body.querySelector<HTMLSelectElement>('#ap-barber')!;
  const serviceSelect = modal.body.querySelector<HTMLSelectElement>('#ap-service')!;
  const dateInput = modal.body.querySelector<HTMLInputElement>('#ap-date')!;
  const timeSelect = modal.body.querySelector<HTMLSelectElement>('#ap-time')!;
  const timeHint = modal.body.querySelector<HTMLElement>('#ap-time-hint')!;
  const errorBox = modal.body.querySelector<HTMLElement>('#ap-error')!;
  const errorText = modal.body.querySelector<HTMLElement>('#ap-error-text')!;

  function showError(message: string): void {
    errorText.textContent = message;
    errorBox.style.display = message ? 'flex' : 'none';
  }

  async function refreshSlots({ keepSelection = false }: { keepSelection?: boolean } = {}): Promise<void> {
    const serviceId = serviceSelect.value;
    const barberId = barberSelect.value;
    const date = dateInput.value;
    const previous = keepSelection ? timeSelect.value || current.start_time : current.start_time;

    if (!serviceId || !barberId || !date) {
      timeSelect.innerHTML = '<option value="">Selecione serviço, profissional e data</option>';
      return;
    }

    timeSelect.innerHTML = '<option value="">Carregando...</option>';
    timeHint.textContent = '';
    showError('');

    try {
      const result = await api.get<AvailabilityResponse>(
        `/api/availability${query({
          barber_id: barberId,
          service_id: serviceId,
          date,
          exclude_id: appointment?.id,
        })}`
      );

      const slots = [...(result.slots ?? [])];
      if (keepSelection && previous && !slots.includes(previous)) {
        slots.unshift(previous);
      }
      if (
        appointment?.start_time &&
        date === appointment.date &&
        barberId === String(appointment.barber_id) &&
        !slots.includes(appointment.start_time)
      ) {
        slots.unshift(appointment.start_time);
      }
      slots.sort();

      if (!slots.length) {
        timeSelect.innerHTML = '<option value="">Nenhum horário livre</option>';
        timeHint.textContent = result.reason || 'Todos os horários deste dia estão ocupados.';
        return;
      }

      timeSelect.innerHTML = slots
        .map((slot) => `<option value="${esc(slot)}"${slot === previous ? ' selected' : ''}>${esc(slot)}</option>`)
        .join('');
      timeHint.textContent = `${slots.length} horários disponíveis`;
    } catch (error: unknown) {
      timeSelect.innerHTML = '<option value="">Erro ao carregar</option>';
      showError(errorMessage(error));
    }
  }

  modal.body.querySelector<HTMLButtonElement>('#ap-new-client')?.addEventListener('click', () => {
    void (async () => {
      const created = await quickCreateClient();
      if (!created) return;
      clients = await api.get<Client[]>('/api/clients');
      clientSelect.innerHTML = `<option value="">Selecione o cliente</option>${options(
        clients,
        created.id,
        (item) => `${item.name} - ${formatPhone(item.phone)}`
      )}`;
      clientSelect.value = String(created.id);
    })();
  });

  barberSelect.addEventListener('change', () => void refreshSlots());
  serviceSelect.addEventListener('change', () => void refreshSlots());
  dateInput.addEventListener('change', () => void refreshSlots());

  modal.setFooter([
    button('Cancelar', () => modal.close(), 'btn btn-ghost'),
    button(
      editing ? `${icon('check')} Salvar alterações` : `${icon('plus')} Agendar`,
      async (event) => {
        const data = readForm(modal.body);
        const clientIdStr = typeof data['client_id'] === 'string' ? data['client_id'] : '';
        const startTimeStr = typeof data['start_time'] === 'string' ? data['start_time'] : '';
        if (!clientIdStr) {
          showError('Selecione o cliente.');
          return;
        }
        if (!startTimeStr) {
          showError('Selecione um horário disponível.');
          return;
        }

        const priceStr = typeof data['price'] === 'string' ? data['price'] : '';
        const payload: Record<string, unknown> = {
          client_id: Number(clientIdStr),
          barber_id: Number(data['barber_id']),
          service_id: Number(data['service_id']),
          date: String(data['date'] ?? ''),
          start_time: startTimeStr,
          notes: String(data['notes'] ?? ''),
          status: data['status'] ? String(data['status']) : undefined,
          payment_method: data['payment_method'] ? String(data['payment_method']) : 'pix',
        };
        if (priceStr !== '') payload['price'] = Number(priceStr);

        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          if (editing && appointment) {
            await api.put(`/api/appointments/${appointment.id}`, payload);
          } else {
            await api.post('/api/appointments', payload);
          }
          modal.close();
          toast(editing ? 'Agendamento atualizado.' : 'Agendamento criado.');
          if (onSaved) onSaved();
        } catch (error: unknown) {
          showError(errorMessage(error));
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);

  await refreshSlots({ keepSelection: editing });
}

export interface OpenAppointmentDetailsOptions {
  onChanged?: (() => void) | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Crédito',
  debit_card: 'Débito',
  cash: 'Dinheiro',
  other: 'Outro',
};

interface WhatsAppPreviewResponse {
  link?: string | null;
  phone?: string;
  message?: string;
}

/** Painel com detalhes e ações rápidas de um agendamento. */
export function openAppointmentDetails(
  appointment: Appointment,
  { onChanged = null }: OpenAppointmentDetailsOptions = {}
): void {
  const paymentLabel = PAYMENT_LABELS[appointment.payment_method ?? 'pix'] ?? 'PIX';
  const body = `
    <div class="grid" style="gap:14px">
      <div class="row-actions">
        ${statusPill(appointment.status)}
        <span class="tag">${esc(appointment.source === 'public' ? 'Agendamento online' : 'Painel')}</span>
      </div>

      <div class="booking-summary">
        <div><span>Cliente</span><strong>${esc(appointment.client_name)}</strong></div>
        <div><span>WhatsApp</span><strong>${esc(formatPhone(appointment.client_phone))}</strong></div>
        <div><span>Serviço</span><strong>${esc(appointment.service_name || '-')}</strong></div>
        <div><span>Profissional</span><strong>${esc(appointment.barber_name)}</strong></div>
        <div><span>Data</span><strong>${esc(formatDateBR(appointment.date))}</strong></div>
        <div><span>Horário</span><strong>${esc(appointment.start_time)} às ${esc(appointment.end_time)}</strong></div>
        <div><span>Valor</span><strong>${esc(money(appointment.price))}</strong></div>
        <div><span>Pagamento</span><strong>${esc(paymentLabel)}</strong></div>
      </div>

      ${appointment.notes ? `<p class="muted"><strong>Observações:</strong> ${esc(appointment.notes)}</p>` : ''}

      <div>
        <p class="muted" style="margin-bottom:8px">Enviar por WhatsApp</p>
        <div class="row-actions">
          <button type="button" class="btn btn-whats btn-sm" data-wa="confirmation">${icon('whatsapp')} Pedir confirmação</button>
          <button type="button" class="btn btn-whats btn-sm" data-wa="reminder">${icon('whatsapp')} Enviar lembrete</button>
          <button type="button" class="btn btn-sm" data-wa="cancellation">${icon('whatsapp')} Avisar cancelamento</button>
        </div>
      </div>

      <div>
        <p class="muted" style="margin-bottom:8px">Alterar status</p>
        <div class="row-actions">
          <button type="button" class="btn btn-ok btn-sm" data-status="confirmed">${icon('check')} Confirmar</button>
          <button type="button" class="btn btn-sm" data-status="completed">${icon('check')} Concluir</button>
          <button type="button" class="btn btn-sm" data-status="pending">${icon('clock')} Aguardando</button>
          <button type="button" class="btn btn-sm" data-status="no_show">${icon('ban')} Não compareceu</button>
          <button type="button" class="btn btn-danger btn-sm" data-status="cancelled">${icon('x')} Cancelar</button>
        </div>
      </div>
    </div>`;

  const modal = openModal({ title: 'Agendamento', body });

  function reload(): void {
    if (onChanged) onChanged();
    else window.dispatchEvent(new CustomEvent('appointments:changed'));
    modal.close();
  }

  modal.body.querySelectorAll<HTMLElement>('[data-wa]').forEach((element) => {
    element.addEventListener('click', () => {
      void (async () => {
        try {
          const waType = element.dataset.wa ?? 'confirmation';
          const result = await api.get<WhatsAppPreviewResponse>(
            `/api/appointments/${appointment.id}/whatsapp?type=${encodeURIComponent(waType)}`
          );
          if (!result.link) {
            toast('Cliente sem telefone válido cadastrado.', 'error');
            return;
          }
          openWhatsapp(result.phone, result.message);
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    });
  });

  modal.body.querySelectorAll<HTMLElement>('[data-status]').forEach((element) => {
    element.addEventListener('click', () => {
      void (async () => {
        const status = element.dataset.status as AppointmentStatus | undefined;
        if (!status) return;
        if (status === 'cancelled') {
          const confirmed = await confirmDialog({
            title: 'Cancelar agendamento',
            message: `Cancelar o horário de ${appointment.client_name} em ${formatDateBR(appointment.date)} às ${appointment.start_time}?`,
            confirmLabel: 'Cancelar agendamento',
            danger: true,
          });
          if (!confirmed) return;
        }
        try {
          await api.patch(`/api/appointments/${appointment.id}/status`, { status });
          toast('Status atualizado.');
          reload();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    });
  });

  modal.setFooter([
    button(
      `${icon('edit')} Editar`,
      () => {
        modal.close();
        void openAppointmentForm({
          appointment,
          onSaved: () => {
            if (onChanged) onChanged();
            else window.dispatchEvent(new CustomEvent('appointments:changed'));
          },
        });
      },
      'btn'
    ),
    button(
      `${icon('trash')} Excluir`,
      async () => {
        const confirmed = await confirmDialog({
          title: 'Excluir agendamento',
          message: 'Esta ação remove o agendamento definitivamente. Deseja continuar?',
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.del(`/api/appointments/${appointment.id}`);
          toast('Agendamento excluído.');
          reload();
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      },
      'btn btn-danger'
    ),
    button('Fechar', () => modal.close(), 'btn btn-primary'),
  ]);
}
