// Componentes compartilhados de agendamento: formulário e painel de detalhes.

import { api, query } from './api.js';
import {
  button,
  confirmDialog,
  esc,
  formatDateBR,
  formatPhone,
  hhmmToMinutes,
  icon,
  money,
  openModal,
  openWhatsapp,
  readForm,
  setBusy,
  statusPill,
  toast,
} from './ui.js';

async function loadCatalog() {
  const [services, barbers, clients] = await Promise.all([
    api.get('/api/services?active=1'),
    api.get('/api/barbers?active=1'),
    api.get('/api/clients'),
  ]);
  return { services, barbers, clients };
}

function options(list, selected, labelFn, valueFn = (item) => item.id) {
  return list
    .map((item) => {
      const value = String(valueFn(item));
      const isSelected = String(selected ?? '') === value ? ' selected' : '';
      return `<option value="${esc(value)}"${isSelected}>${esc(labelFn(item))}</option>`;
    })
    .join('');
}

/** Cadastro rápido de cliente a partir do formulário de agendamento. */
async function quickCreateClient() {
  return new Promise((resolve) => {
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
      button('Cancelar', () => {
        modal.close();
        resolve(null);
      }, 'btn btn-ghost'),
      button(`${icon('check')} Cadastrar`, async (event) => {
        const data = readForm(modal.body);
        if (!data.name || !data.phone) {
          toast('Informe nome e WhatsApp.', 'error');
          return;
        }
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          const created = await api.post('/api/clients', data);
          modal.close();
          toast('Cliente cadastrado.');
          resolve(created);
        } catch (error) {
          toast(error.message, 'error');
          setBusy(event.currentTarget, false);
        }
      }, 'btn btn-primary'),
    ]);
    modal.onClose(() => resolve(null));
  });
}

export async function openAppointmentForm({ appointment = null, defaults = {}, onSaved = null } = {}) {
  const editing = Boolean(appointment?.id);
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (error) {
    toast(error.message, 'error');
    return;
  }

  const { services, barbers } = catalog;
  let clients = catalog.clients;

  if (!services.length) {
    toast('Cadastre pelo menos um serviço antes de agendar.', 'error');
    return;
  }
  if (!barbers.length) {
    toast('Cadastre pelo menos um profissional antes de agendar.', 'error');
    return;
  }

  const current = {
    client_id: appointment?.client_id ?? defaults.client_id ?? '',
    barber_id: appointment?.barber_id ?? defaults.barber_id ?? barbers[0].id,
    service_id: appointment?.service_id ?? defaults.service_id ?? services[0].id,
    date: appointment?.date ?? defaults.date ?? new Date().toISOString().slice(0, 10),
    start_time: appointment?.start_time ?? defaults.start_time ?? '',
    status: appointment?.status ?? 'pending',
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

  const clientSelect = modal.body.querySelector('#ap-client');
  const barberSelect = modal.body.querySelector('#ap-barber');
  const serviceSelect = modal.body.querySelector('#ap-service');
  const dateInput = modal.body.querySelector('#ap-date');
  const timeSelect = modal.body.querySelector('#ap-time');
  const timeHint = modal.body.querySelector('#ap-time-hint');
  const errorBox = modal.body.querySelector('#ap-error');
  const errorText = modal.body.querySelector('#ap-error-text');

  function showError(message) {
    errorText.textContent = message;
    errorBox.style.display = message ? 'flex' : 'none';
  }

  async function refreshSlots({ keepSelection = false } = {}) {
    const serviceId = serviceSelect.value;
    const barberId = barberSelect.value;
    const date = dateInput.value;
    const previous = keepSelection ? timeSelect.value : '';

    if (!serviceId || !barberId || !date) {
      timeSelect.innerHTML = '<option value="">Selecione serviço, profissional e data</option>';
      return;
    }

    timeSelect.innerHTML = '<option value="">Carregando...</option>';
    timeHint.textContent = '';
    showError('');

    try {
      const result = await api.get(
        `/api/availability${query({
          barber_id: barberId,
          service_id: serviceId,
          date,
          exclude_id: appointment?.id,
        })}`
      );

      const slots = [...(result.slots || [])];
      if (previous && !slots.includes(previous)) slots.unshift(previous);
      if (appointment?.start_time && date === appointment.date && barberId === String(appointment.barber_id) && !slots.includes(appointment.start_time)) {
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
    } catch (error) {
      timeSelect.innerHTML = '<option value="">Erro ao carregar</option>';
      showError(error.message);
    }
  }

  modal.body.querySelector('#ap-new-client').addEventListener('click', async () => {
    const created = await quickCreateClient();
    if (!created) return;
    clients = await api.get('/api/clients');
    clientSelect.innerHTML = `<option value="">Selecione o cliente</option>${options(
      clients,
      created.id,
      (item) => `${item.name} - ${formatPhone(item.phone)}`
    )}`;
    clientSelect.value = String(created.id);
  });

  barberSelect.addEventListener('change', () => refreshSlots());
  serviceSelect.addEventListener('change', () => refreshSlots());
  dateInput.addEventListener('change', () => refreshSlots());

  modal.setFooter([
    button('Cancelar', () => modal.close(), 'btn btn-ghost'),
    button(editing ? `${icon('check')} Salvar alterações` : `${icon('plus')} Agendar`, async (event) => {
      const data = readForm(modal.body);
      if (!data.client_id) {
        showError('Selecione o cliente.');
        return;
      }
      if (!data.start_time) {
        showError('Selecione um horário disponível.');
        return;
      }

      const payload = {
        client_id: Number(data.client_id),
        barber_id: Number(data.barber_id),
        service_id: Number(data.service_id),
        date: data.date,
        start_time: data.start_time,
        notes: data.notes,
        status: data.status,
      };
      if (data.price !== '') payload.price = Number(data.price);

      setBusy(event.currentTarget, true, 'Salvando...');
      try {
        if (editing) await api.put(`/api/appointments/${appointment.id}`, payload);
        else await api.post('/api/appointments', payload);
        modal.close();
        toast(editing ? 'Agendamento atualizado.' : 'Agendamento criado.');
        if (onSaved) onSaved();
      } catch (error) {
        showError(error.message);
        setBusy(event.currentTarget, false);
      }
    }, 'btn btn-primary'),
  ]);

  await refreshSlots({ keepSelection: editing });
}

/** Painel com detalhes e ações rápidas de um agendamento. */
export function openAppointmentDetails(appointment, { onChanged = null } = {}) {
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

  function reload() {
    if (onChanged) onChanged();
    else window.dispatchEvent(new CustomEvent('appointments:changed'));
    modal.close();
  }

  modal.body.querySelectorAll('[data-wa]').forEach((element) => {
    element.addEventListener('click', async () => {
      try {
        const result = await api.get(`/api/appointments/${appointment.id}/whatsapp?type=${element.dataset.wa}`);
        if (!result.link) {
          toast('Cliente sem telefone válido cadastrado.', 'error');
          return;
        }
        openWhatsapp(result.phone, result.message);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });

  modal.body.querySelectorAll('[data-status]').forEach((element) => {
    element.addEventListener('click', async () => {
      const status = element.dataset.status;
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
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });

  modal.setFooter([
    button(`${icon('edit')} Editar`, () => {
      modal.close();
      openAppointmentForm({
        appointment,
        onSaved: () => {
          if (onChanged) onChanged();
          else window.dispatchEvent(new CustomEvent('appointments:changed'));
        },
      });
    }, 'btn'),
    button(`${icon('trash')} Excluir`, async () => {
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
      } catch (error) {
        toast(error.message, 'error');
      }
    }, 'btn btn-danger'),
    button('Fechar', () => modal.close(), 'btn btn-primary'),
  ]);
}
