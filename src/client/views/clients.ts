import { api, errorMessage, query } from '../api.js';
import { openAppointmentForm } from '../appointments-ui.js';
import {
  content,
} from '../panel-context.js';
import type {
  Client,
  ClientWithHistory,
} from '../types.js';
import {
  button,
  confirmDialog,
  debounce,
  emptyBlock,
  esc,
  formatDateBR,
  formatPhone,
  hydrateLottieElements,
  icon,
  initials,
  money,
  openModal,
  openWhatsapp,
  readForm,
  setBusy,
  skeletonTable,
  statusPill,
  toast,
  todayISO,
} from '../ui.js';


/* --------------------------------- Clientes ------------------------------- */

export async function viewClients(): Promise<void> {
  content().innerHTML = `
    <div class="toolbar">
      <div class="search-input">
        ${icon('search')}
        <input id="cl-search" placeholder="Buscar por nome, telefone ou e-mail" />
      </div>
      <span class="grow"></span>
      <button class="btn btn-primary" id="cl-new" type="button">${icon('plus')} Novo cliente</button>
    </div>
    <div id="clients-holder">${skeletonTable(6)}</div>`;

  document.getElementById('cl-new')?.addEventListener('click', () => openClientForm(null));
  const searchInput = document.getElementById('cl-search') as HTMLInputElement | null;
  const debouncedSearch = debounce((term: string) => void loadClients(term), 340);
  searchInput?.addEventListener('input', () => debouncedSearch(searchInput.value.trim()));

  await loadClients('');
}

async function loadClients(search: string): Promise<void> {
  const holder = document.getElementById('clients-holder');
  if (!holder) return;
  holder.innerHTML = skeletonTable(6);

  let rows: Client[];
  try {
    rows = await api.get<Client[]>(`/api/clients${query({ search })}`);
  } catch (error: unknown) {
    holder.innerHTML = emptyBlock('Erro ao buscar clientes', errorMessage(error));
    hydrateLottieElements(holder);
    return;
  }

  if (!rows.length) {
    holder.innerHTML = `<div class="table-wrap">${emptyBlock(
      'Nenhum cliente cadastrado',
      'Cadastre o primeiro cliente para começar a agendar.'
    )}</div>`;
    hydrateLottieElements(holder);
    return;
  }

  holder.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th>Cliente</th><th>WhatsApp</th><th>E-mail</th><th>Atendimentos</th><th>Última visita</th><th class="actions">Ações</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (client) => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <div class="avatar">${esc(initials(client.name))}</div>
                  <div><span class="cell-strong">${esc(client.name)}</span>${
                    client.notes ? `<div class="cell-sub">${esc(client.notes)}</div>` : ''
                  }</div>
                </div>
              </td>
              <td class="mono">${esc(formatPhone(client.phone))}</td>
              <td class="muted">${esc(client.email || '-')}</td>
              <td class="mono">${Number(client.appointments_total || 0)}</td>
              <td class="mono">${client.last_visit ? esc(formatDateBR(client.last_visit)) : '-'}</td>
              <td class="actions">
                <div class="row-actions" style="justify-content:flex-end">
                  <button class="btn btn-sm" data-history="${client.id}" type="button">${icon('list')} Histórico</button>
                  <button class="btn btn-sm" data-schedule="${client.id}" type="button">${icon('plus')} Agendar</button>
                  <button class="btn btn-sm" data-edit="${client.id}" type="button">${icon('edit')} Editar</button>
                  <button class="btn btn-sm btn-danger" data-del="${client.id}" type="button">${icon('trash')} Excluir</button>
                </div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  holder.querySelectorAll<HTMLElement>('[data-edit]').forEach((element) =>
    element.addEventListener('click', () => {
      const client = rows.find((item) => Number(item.id) === Number(element.dataset.edit)) ?? null;
      openClientForm(client);
    })
  );
  holder.querySelectorAll<HTMLElement>('[data-history]').forEach((element) =>
    element.addEventListener('click', () => {
      if (element.dataset.history) void openClientHistory(element.dataset.history);
    })
  );
  holder.querySelectorAll<HTMLElement>('[data-schedule]').forEach((element) =>
    element.addEventListener('click', () => {
      void openAppointmentForm({
        defaults: { client_id: Number(element.dataset.schedule), date: todayISO() },
        onSaved: () => {
          void loadClients('');
        },
      });
    })
  );
  holder.querySelectorAll<HTMLElement>('[data-del]').forEach((element) =>
    element.addEventListener('click', () => {
      void (async () => {
        const client = rows.find((item) => Number(item.id) === Number(element.dataset.del));
        if (!client) return;
        const confirmed = await confirmDialog({
          title: 'Excluir cliente',
          message: `Excluir ${client.name}? O histórico de agendamentos também será removido.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.del(`/api/clients/${client.id}`);
          toast('Cliente excluído.');
          await loadClients('');
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
        }
      })();
    })
  );
}

function openClientForm(client: Client | null): void {
  const editing = Boolean(client?.id);
  const body = `
    <div class="form-grid">
      <div class="field span-2">
        <label>Nome completo</label>
        <input name="name" value="${esc(client?.name || '')}" placeholder="Nome do cliente" />
      </div>
      <div class="field">
        <label>WhatsApp</label>
        <input name="phone" value="${esc(client?.phone || '')}" placeholder="(11) 99999-9999" />
      </div>
      <div class="field">
        <label>E-mail</label>
        <input name="email" type="email" value="${esc(client?.email || '')}" placeholder="opcional" />
      </div>
      <div class="field">
        <label>Data de nascimento</label>
        <input name="birth_date" type="date" value="${esc(client?.birth_date || '')}" />
      </div>
      <div class="field span-2">
        <label>Observações</label>
        <textarea name="notes" placeholder="Preferências, alergias...">${esc(client?.notes || '')}</textarea>
      </div>
    </div>`;

  const modal = openModal({ title: editing ? 'Editar cliente' : 'Novo cliente', body });
  modal.setFooter([
    button('Cancelar', () => modal.close(), 'btn btn-ghost'),
    button(
      editing ? `${icon('check')} Salvar alterações` : `${icon('plus')} Cadastrar cliente`,
      async (event) => {
        const data = readForm(modal.body);
        if (!data['name']) {
          toast('Informe o nome do cliente.', 'error');
          return;
        }
        if (!data['phone']) {
          toast('Informe o WhatsApp.', 'error');
          return;
        }
        setBusy(event.currentTarget, true, 'Salvando...');
        try {
          if (editing && client) await api.put(`/api/clients/${client.id}`, data);
          else await api.post('/api/clients', data);
          modal.close();
          toast(editing ? 'Cliente atualizado.' : 'Cliente cadastrado.');
          await loadClients('');
        } catch (error: unknown) {
          toast(errorMessage(error), 'error');
          setBusy(event.currentTarget, false);
        }
      },
      'btn btn-primary'
    ),
  ]);
}

async function openClientHistory(id: string): Promise<void> {
  let client: ClientWithHistory;
  try {
    client = await api.get<ClientWithHistory>(`/api/clients/${id}`);
  } catch (error: unknown) {
    toast(errorMessage(error), 'error');
    return;
  }

  const history = client.history || [];
  const body = `
    <div class="grid" style="gap:14px">
      <div class="booking-summary">
        <div><span>Nome</span><strong>${esc(client.name)}</strong></div>
        <div><span>WhatsApp</span><strong>${esc(formatPhone(client.phone))}</strong></div>
        <div><span>E-mail</span><strong>${esc(client.email || '-')}</strong></div>
        <div><span>Atendimentos</span><strong>${Number(client.appointments_total || 0)}</strong></div>
        <div><span>Última visita</span><strong>${client.last_visit ? esc(formatDateBR(client.last_visit)) : '-'}</strong></div>
      </div>
      ${
        history.length
          ? `<div class="table-wrap">
               <table class="data" style="min-width:420px">
                 <thead><tr><th>Data</th><th>Hora</th><th>Serviço</th><th>Profissional</th><th>Valor</th><th>Status</th></tr></thead>
                 <tbody>
                   ${history
                     .map(
                       (item) => `
                     <tr>
                       <td class="mono">${esc(formatDateBR(item.date))}</td>
                       <td class="mono">${esc(item.start_time)}</td>
                       <td>${esc(item.service_name || '-')}</td>
                       <td>${esc(item.barber_name)}</td>
                       <td class="mono">${esc(money(item.price))}</td>
                       <td>${statusPill(item.status)}</td>
                     </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>`
          : emptyBlock('Sem atendimentos registrados')
      }
    </div>`;

  const modal = openModal({ title: 'Histórico do cliente', body });
  modal.setFooter([
    button(
      `${icon('whatsapp')} WhatsApp`,
      () => openWhatsapp(client.phone, `Olá ${client.name}! Tudo bem?`),
      'btn btn-whats'
    ),
    button('Fechar', () => modal.close(), 'btn btn-primary'),
  ]);
}

