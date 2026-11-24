import { ApiError, api, errorMessage } from '../api.js';
import {
  content,
  refresh,
  state,
  submitShopClosure,
  triggerLoginScreen,
} from '../panel-context.js';
import type {
  AuthMeResponse,
  BusinessHours,
  Closure,
  Settings,
  WhatsAppConfig,
  WhatsAppMessage,
} from '../types.js';
import {
  addDays,
  button,
  confirmDialog,
  emptyBlock,
  esc,
  formatDateBR,
  formatPhone,
  hydrateLottieElements,
  icon,
  openModal,
  setBusy,
  toast,
  todayISO,
  WEEKDAYS_SHORT,
} from '../ui.js';


/* ------------------------------ Configurações ----------------------------- */

function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return String(iso);
  }
}

function renderWhatsAppHistoryTable(messages: WhatsAppMessage[]): string {
  if (!messages || !messages.length) {
    return `<div class="empty-block" style="padding:24px; text-align:center; color:var(--text-dim)">Nenhuma mensagem registrada até o momento.</div>`;
  }
  const typeLabels: Record<string, string> = {
    confirmation: 'Confirmação',
    reminder: 'Lembrete 24h',
    cancellation: 'Cancelamento',
    reschedule: 'Reagendamento',
    team_alert: 'Alerta Equipe',
    test: 'Teste Manual',
  };
  const statusBadges: Record<string, string> = {
    sent: '<span class="pill pill-confirmed">Enviado</span>',
    delivered: '<span class="pill pill-completed">Entregue</span>',
    read: '<span class="pill pill-confirmed" style="background:rgba(52,211,153,0.22)">Lido</span>',
    pending: '<span class="pill pill-pending">Pendente</span>',
    failed: '<span class="pill pill-cancelled">Falhou</span>',
  };
  return `
    <table class="table" style="width:100%; border-collapse:collapse">
      <thead>
        <tr>
          <th>Data / Hora</th>
          <th>Tipo</th>
          <th>Destinatário</th>
          <th>Agendamento</th>
          <th>Status</th>
          <th>Ações / Detalhes</th>
        </tr>
      </thead>
      <tbody>
        ${messages
          .map(
            (msg) => `
          <tr>
            <td class="mono" style="font-size:12px; white-space:nowrap">${esc(formatDateTimeBR(msg.created_at))}</td>
            <td><strong>${esc(typeLabels[msg.message_type] || msg.message_type)}</strong></td>
            <td>
              <div>${esc(msg.recipient_name || 'Destinatário')}</div>
              <div class="mono muted" style="font-size:11px">${esc(formatPhone(msg.recipient_phone))}</div>
            </td>
            <td>
              ${
                msg.appointment_id
                  ? `
                <div style="font-size:12px">#${esc(msg.appointment_id)} - ${esc(msg.client_name || '')}</div>
                <div class="muted" style="font-size:11px">${msg.appointment_date ? esc(formatDateBR(msg.appointment_date)) : ''} ${esc(msg.appointment_time || '')}</div>
              `
                  : '<span class="muted">-</span>'
              }
            </td>
            <td>${statusBadges[msg.status] || `<span class="pill pill-neutral">${esc(msg.status)}</span>`}</td>
            <td>
              ${
                msg.error_message
                  ? `
                <div style="color:#f87171; font-size:11px; max-width:260px; word-break:break-word" title="${esc(msg.error_message)}">
                  ${esc(msg.error_message.slice(0, 95))}
                </div>
              `
                  : ''
              }
              ${
                msg.meta_message_id
                  ? `
                <div class="mono muted" style="font-size:10px" title="ID da Meta: ${esc(msg.meta_message_id)}">
                  ID: ${esc(msg.meta_message_id.slice(0, 16))}...
                </div>
              `
                  : ''
              }
              ${
                msg.status === 'failed'
                  ? `
                <button class="btn btn-sm btn-ghost resend-wa-btn" data-id="${msg.id}" type="button" style="margin-top:4px; font-size:11px; padding:2px 8px">
                  Reenviar
                </button>
              `
                  : ''
              }
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

export async function viewSettings(): Promise<void> {
  const [settings, businessHours, closures, waConfig, waMessages] = await Promise.all([
    api.get<Settings>('/api/settings'),
    api.get<BusinessHours[]>('/api/business-hours'),
    api.get<Closure[]>('/api/closures'),
    api.get<WhatsAppConfig>('/api/whatsapp/config').catch(() => null),
    api.get<WhatsAppMessage[]>('/api/whatsapp/messages?limit=25').catch(() => [] as WhatsAppMessage[]),
  ]);
  state.settings = settings;

  const saved = (message: string): void => toast(message);

  const businessRows = [0, 1, 2, 3, 4, 5, 6]
    .map((weekday) => {
      const day = businessHours.find((item) => Number(item.weekday) === weekday) ?? {
        weekday,
        is_open: 0,
        open_time: '09:00',
        close_time: '19:00',
        break_start: '',
        break_end: '',
      };
      const isOpen = Boolean(Number(day.is_open));
      return `
        <div class="hours-row" data-hours-row="${weekday}" style="${isOpen ? '' : 'opacity:0.65'}">
          <label class="field-check" style="gap:8px">
            <input type="checkbox" data-w="${weekday}" data-k="is_open" ${isOpen ? 'checked' : ''} />
            <span>${esc(WEEKDAYS_SHORT[weekday] ?? '')}</span>
            <span class="pill ${isOpen ? 'pill-confirmed' : 'pill-cancelled'}" data-w-badge="${weekday}" style="font-size:10.5px;padding:2px 7px">${isOpen ? 'Aberto' : 'Folga'}</span>
          </label>
          <input class="control" type="time" data-w="${weekday}" data-k="open_time" value="${esc(day.open_time || '09:00')}" ${isOpen ? '' : 'disabled'} />
          <input class="control" type="time" data-w="${weekday}" data-k="close_time" value="${esc(day.close_time || '19:00')}" ${isOpen ? '' : 'disabled'} />
          <input class="control" type="time" data-w="${weekday}" data-k="break_start" value="${esc(day.break_start || '')}" ${isOpen ? '' : 'disabled'} />
          <input class="control" type="time" data-w="${weekday}" data-k="break_end" value="${esc(day.break_end || '')}" ${isOpen ? '' : 'disabled'} />
        </div>`;
    })
    .join('');

  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const todayHasClosure = closures.some((c) => c.date === today);

  const closuresHtml = closures.length
    ? `<div>${closures
        .map(
          (closure) => `
        <div class="list-row">
          <div class="grow" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>${esc(formatDateBR(closure.date))}</strong>
            ${closure.date === today ? '<span class="pill pill-cancelled" style="font-size:10.5px">Hoje</span>' : ''}
            <span class="muted">${esc(closure.reason || 'Folga')}</span>
          </div>
          <button class="btn btn-sm btn-danger" data-closure="${closure.id}" type="button">Remover folga</button>
        </div>`
        )
        .join('')}</div>`
    : emptyBlock('Nenhuma folga ou feriado cadastrado');

  const publicLink = `${location.origin}/agendar`;
  const waConfigured = Boolean(waConfig?.configured || waConfig?.is_configured);

  content().innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><h2>Dados da barbearia</h2></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field">
            <label>Nome exibido</label>
            <input class="control" name="shop_name" value="${esc(settings.shop_name || 'Gestor de Barbearia')}" />
          </div>
          <div class="field">
            <label>Nome da empresa ou rede</label>
            <input class="control" name="shop_company" value="${esc(settings.shop_company || 'Barbearia & Barber Shop')}" />
          </div>
          <div class="field">
            <label>Telefone</label>
            <input class="control" name="shop_phone" value="${esc(settings.shop_phone || '')}" />
          </div>
          <div class="field">
            <label>WhatsApp da barbearia</label>
            <input class="control" name="shop_whatsapp" value="${esc(settings.shop_whatsapp || '')}" />
          </div>
          <div class="field">
            <label>Endereço</label>
            <input class="control" name="shop_address" value="${esc(settings.shop_address || '')}" />
          </div>
          <div class="field">
            <label>Instagram</label>
            <input class="control" name="shop_instagram" value="${esc(settings.shop_instagram || '')}" />
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="save-shop" type="button">${icon('check')} Salvar dados</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Agendamento online</h2></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <label class="field-check">
            <input type="checkbox" id="public_booking" ${String(settings.public_booking) === '1' ? 'checked' : ''} />
            <span>Permitir que clientes agendem pelo celular</span>
          </label>
          <div class="field">
            <label>Intervalo entre horários (minutos)</label>
            <input class="control" type="number" min="5" max="120" step="5" id="slot_interval" value="${esc(settings.slot_interval || 15)}" />
          </div>
          <div class="field">
            <label>Antecedência mínima (minutos)</label>
            <input class="control" type="number" min="0" max="1440" step="15" id="min_advance_minutes" value="${esc(settings.min_advance_minutes || 0)}" />
          </div>
          <div class="field">
            <label>Antecedência máxima (dias)</label>
            <input class="control" type="number" min="1" max="365" step="1" id="max_advance_days" value="${esc(settings.max_advance_days || 60)}" />
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="save-booking" type="button">${icon('check')} Salvar agendamento</button>
        </div>
        <div class="section-title" style="margin-top:22px">Link para o cliente</div>
        <div class="link-row">
          <div class="code-inline" id="public-link">${esc(publicLink)}</div>
          <button class="btn btn-sm" id="copy-link" type="button">${icon('copy')} Copiar link</button>
          <a class="btn btn-sm" href="/agendar" target="_blank" rel="noopener">${icon('external')} Abrir</a>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header" style="flex-wrap:wrap;gap:10px">
        <div>
          <h2>Horário de funcionamento &amp; Folga Semanal</h2>
          <div class="card-sub">Desmarque os dias da semana em que a barbearia fica de folga (fechada)</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" type="button" data-hours-preset="mon-sat">Seg–Sáb (Dom Folga)</button>
        <button class="btn btn-ghost btn-sm" type="button" data-hours-preset="tue-sat">Ter–Sáb (Dom/Seg Folga)</button>
        <button class="btn btn-ghost btn-sm" type="button" data-hours-preset="all-open">Abrir Todos os Dias</button>
        <button class="btn btn-primary btn-sm" id="save-hours" type="button">${icon('check')} Salvar horários e folgas</button>
      </div>
      <div class="hours-head">
        <span>Dia / Status</span><span>Abre</span><span>Fecha</span><span>Intervalo início</span><span>Intervalo fim</span>
      </div>
      ${businessRows}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:8px">
          <div>
            <h2>Dias de Folga, Feriados &amp; Fechamento</h2>
            <div class="card-sub">Bloqueie datas específicas e atualize o status "Fechado hoje" na página de agendamento</div>
          </div>
        </div>
        <div class="row-actions" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm ${todayHasClosure ? 'btn-ghost' : 'btn-danger'}" id="quick-close-today" type="button" ${todayHasClosure ? 'disabled' : ''}>
            ${icon('ban')} ${todayHasClosure ? 'Hoje já está marcado como Folga' : 'Fechar Hoje (Folga Hoje)'}
          </button>
          <button class="btn btn-sm btn-ghost" id="quick-close-tomorrow" type="button">
            ${icon('calendar')} Fechar Amanhã (${esc(formatDateBR(tomorrow))})
          </button>
        </div>
        <div class="row-actions" style="margin-bottom:14px">
          <input class="control" type="date" id="closure-date" value="${esc(today)}" />
          <input class="control grow" id="closure-reason" placeholder="Motivo (ex: Folga, Feriado, Reforma)" />
          <button class="btn btn-primary" id="add-closure" type="button">${icon('plus')} Adicionar folga</button>
        </div>
        ${closuresHtml}
      </div>

      <div class="card">
        <div class="card-header"><h2>Segurança</h2></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field">
            <label>Senha atual</label>
            <input class="control" type="password" id="current_password" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>Nova senha</label>
            <input class="control" type="password" id="new_password" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>Confirmar nova senha</label>
            <input class="control" type="password" id="confirm_password" autocomplete="new-password" />
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button class="btn btn-primary" id="save-password" type="button">${icon('lock')} Alterar senha</button>
          <button class="btn btn-ghost" id="logout-all-devices" type="button">${icon('logout')} Sair de todos os dispositivos</button>
        </div>
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div>
              <strong style="font-size:13px">Autenticação em 2 etapas (2FA / TOTP)</strong>
              <p class="faint" style="font-size:12px;margin-top:2px">
                ${state.me?.totp_enabled ? 'Ativada nesta conta.' : 'Opcional para administradores; obrigatória para contas Master.'}
              </p>
            </div>
            ${
              state.me?.totp_enabled
                ? state.me?.is_master
                  ? '<span class="pill pill-confirmed">Obrigatório (Ativo)</span>'
                  : '<button class="btn btn-ghost btn-sm" id="disable-totp-btn" type="button">Desativar 2FA</button>'
                : '<button class="btn btn-ghost btn-sm" id="setup-totp-btn" type="button">Configurar 2FA</button>'
            }
          </div>
          <div id="totp-setup-box" class="hidden" style="margin-top:12px"></div>
        </div>
        <p class="faint" style="margin-top:12px;font-size:12px">
          A senha é armazenada com hash scrypt e a sessão é assinada no servidor.
        </p>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <h2>Mensagens de WhatsApp</h2>
        <span class="spacer"></span>
        <button class="btn btn-primary btn-sm" id="save-templates" type="button">${icon('check')} Salvar mensagens</button>
      </div>
      <p class="muted" style="margin-bottom:14px">
        Variáveis disponíveis: <b>{cliente}</b>, <b>{loja}</b>, <b>{data}</b>, <b>{hora}</b>,
        <b>{barbeiro}</b>, <b>{serviço}</b>. Os botões usam links oficiais do WhatsApp (wa.me).
      </p>
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="field">
          <label>Pedido de confirmação</label>
          <textarea id="tpl_confirmation" placeholder="Olá {cliente}! Aqui é da {loja}. Seu horário está agendado para {data} às {hora} com {barbeiro} ({serviço}). Podemos confirmar?">${esc(settings.whatsapp_message_confirmation || '')}</textarea>
        </div>
        <div class="field">
          <label>Lembrete</label>
          <textarea id="tpl_reminder" placeholder="Oi {cliente}! Lembrete do seu horário na {loja}: {data} às {hora} com {barbeiro}. Esperamos você!">${esc(settings.whatsapp_message_reminder || '')}</textarea>
        </div>
        <div class="field">
          <label>Aviso de cancelamento</label>
          <textarea id="tpl_cancellation" placeholder="Olá {cliente}, seu horário na {loja} em {data} às {hora} foi cancelado. Se quiser, podemos reagendar.">${esc(settings.whatsapp_message_cancellation || '')}</textarea>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div>
          <h2>WhatsApp Business Cloud API (Oficial da Meta)</h2>
          <div class="card-sub">Envio 100% automático e oficial de confirmações, lembretes de 24h e cancelamentos</div>
        </div>
        <span class="spacer"></span>
        <span class="pill ${waConfigured ? 'pill-confirmed' : 'pill-pending'}">
          ${waConfigured ? (waConfig?.enabled ? 'Ativo e Operacional' : 'Configurado (Pausado)') : 'Não Configurado'}
        </span>
        <button class="btn btn-ghost btn-sm" id="test-whatsapp-cloud" type="button" style="margin-left:8px">
          ${icon('whatsapp')} Testar Envio
        </button>
        <button class="btn btn-ghost btn-sm" id="trigger-reminders-now" type="button">
          ${icon('clock')} Disparar Lembretes 24h
        </button>
        <button class="btn btn-primary btn-sm" id="save-whatsapp-cloud" type="button">
          ${icon('check')} Salvar WhatsApp
        </button>
      </div>

      <div style="margin-top:12px; margin-bottom:16px; padding:12px; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-soft)">
        <label class="field-check">
          <input type="checkbox" id="whatsapp_cloud_enabled" ${waConfig?.enabled ? 'checked' : ''} />
          <strong>Ativar envio automático oficial via WhatsApp Business Cloud API</strong>
        </label>
        <div class="muted" style="margin-top:4px; font-size:12px">
          Ao ativar, o sistema enviará as mensagens diretamente pelos servidores oficiais da Meta sem abrir o WhatsApp Web ou o app do celular.
        </div>
      </div>

      <div class="grid grid-2" style="gap:16px">
        <div>
          <h3 style="font-size:14px; margin-bottom:12px; color:var(--text-main)">Credenciais da Meta</h3>
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="field">
              <label>Phone Number ID (ID do número na Meta)</label>
              <input class="control mono" id="whatsapp_phone_number_id" value="${esc(waConfig?.phone_number_id || '')}" placeholder="Ex: 104829384910293" />
            </div>
            <div class="field">
              <label>WhatsApp Business Account ID (WABA ID)</label>
              <input class="control mono" id="whatsapp_business_account_id" value="${esc(waConfig?.business_account_id || '')}" placeholder="Ex: 109283746192837" />
            </div>
            <div class="field">
              <label>Token de Acesso Permanente (System User Token)</label>
              <input class="control mono" type="password" id="whatsapp_access_token" placeholder="${waConfig?.has_access_token ? '•••••••••••• (já configurado — deixe em branco para manter)' : 'Cole o token de acesso Bearer da Meta'}" />
              <div class="muted" style="font-size:11px; margin-top:2px">
                ${waConfig?.has_access_token ? '<span style="color:#34d399">✔ Token armazenado com segurança no servidor</span>' : 'Nunca exposto no frontend ou navegador'}
              </div>
            </div>
            <div class="field">
              <label>Versão da Graph API</label>
              <input class="control mono" id="whatsapp_api_version" value="${esc(waConfig?.api_version || 'v21.0')}" placeholder="v21.0" />
            </div>
          </div>
        </div>

        <div>
          <h3 style="font-size:14px; margin-bottom:12px; color:var(--text-main)">Notificações e Lembretes</h3>
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="field">
              <label>WhatsApp do Administrador (para alertas de equipe)</label>
              <input class="control" id="whatsapp_admin_phone" value="${esc(waConfig?.admin_phone || '')}" placeholder="Ex: 11999999999" />
            </div>
            <label class="field-check">
              <input type="checkbox" id="whatsapp_notify_admin" ${waConfig?.notify_admin ? 'checked' : ''} />
              <span>Notificar administrador em novos agendamentos</span>
            </label>
            <label class="field-check">
              <input type="checkbox" id="whatsapp_notify_barber" ${waConfig?.notify_barber ? 'checked' : ''} />
              <span>Notificar barbeiro responsável em novos agendamentos</span>
            </label>
            <div style="display:flex; gap:10px; align-items:center; margin-top:8px">
              <label class="field-check" style="flex:1">
                <input type="checkbox" id="whatsapp_reminder_enabled" ${waConfig?.reminder_enabled ? 'checked' : ''} />
                <span>Enviar lembrete automático</span>
              </label>
              <div style="display:flex; align-items:center; gap:6px">
                <input class="control mono" style="width:70px" type="number" min="1" max="72" id="whatsapp_reminder_hours" value="${esc(waConfig?.reminder_hours || 24)}" />
                <span class="muted" style="font-size:12px">horas antes</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border-soft)">
        <h3 style="font-size:14px; margin-bottom:8px">Modelos de Mensagem (Templates) da Meta</h3>
        <p class="muted" style="margin-bottom:12px; font-size:12px">
          Para mensagens de lembrete iniciadas pela barbearia fora da janela de 24 horas, a Meta exige templates pré-aprovados.
        </p>
        <div style="margin-bottom:12px">
          <label class="field-check">
            <input type="checkbox" id="whatsapp_use_templates" ${waConfig?.use_templates ? 'checked' : ''} />
            <span>Utilizar templates da Meta (se desmarcado, envia mensagens de texto padrão)</span>
          </label>
        </div>
        <div class="grid grid-2" style="gap:12px">
          <div class="field">
            <label>Template Confirmação</label>
            <input class="control mono" id="whatsapp_template_confirmation" value="${esc(waConfig?.templates?.confirmation || 'confirmacao_agendamento')}" />
          </div>
          <div class="field">
            <label>Template Lembrete 24h</label>
            <input class="control mono" id="whatsapp_template_reminder" value="${esc(waConfig?.templates?.reminder || 'lembrete_agendamento')}" />
          </div>
          <div class="field">
            <label>Template Cancelamento</label>
            <input class="control mono" id="whatsapp_template_cancellation" value="${esc(waConfig?.templates?.cancellation || 'cancelamento_agendamento')}" />
          </div>
          <div class="field">
            <label>Template Reagendamento</label>
            <input class="control mono" id="whatsapp_template_reschedule" value="${esc(waConfig?.templates?.reschedule || 'reagendamento_agendamento')}" />
          </div>
        </div>
      </div>

      <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border-soft)">
        <h3 style="font-size:14px; margin-bottom:6px">Webhook da Meta (Recibos de Entrega e Leitura)</h3>
        <p class="muted" style="margin-bottom:10px; font-size:12px">
          Configure este endereço no painel do Meta for Developers para receber status em tempo real de entrega (enviado, entregue, lido):
        </p>
        <div class="grid grid-2" style="gap:12px">
          <div class="field">
            <label>URL de Retorno (Callback URL)</label>
            <input class="control mono" readonly value="${esc(waConfig?.webhook_callback_url || `${location.origin}/api/whatsapp/webhook`)}" />
          </div>
          <div class="field">
            <label>Token de Verificação (Verify Token)</label>
            <input class="control mono" type="password" id="whatsapp_webhook_verify_token" placeholder="${waConfig?.has_webhook_token ? '•••••••••••• (configurado)' : 'Defina um segredo alfanumérico'}" />
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div>
          <h2>Histórico e Auditoria de Mensagens do WhatsApp</h2>
          <div class="card-sub">Registro de envios, confirmações de entrega, leituras e tratamento de falhas</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" id="refresh-whatsapp-history" type="button">
          ${icon('clock')} Atualizar Histórico
        </button>
      </div>

      <div class="table-wrap" id="whatsapp-history-wrap" style="margin-top:12px">
        ${renderWhatsAppHistoryTable(waMessages)}
      </div>
    </div>`;

  hydrateLottieElements(content());

  const field = (name: string): HTMLInputElement | null =>
    content().querySelector<HTMLInputElement>(`[name="${name}"]`);
  const plain = <T extends HTMLElement = HTMLInputElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  plain<HTMLButtonElement>('save-shop')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      setBusy(event.currentTarget, true);
      try {
        await api.put('/api/settings', {
          shop_name: field('shop_name')?.value ?? '',
          shop_company: field('shop_company')?.value ?? '',
          shop_phone: field('shop_phone')?.value ?? '',
          shop_whatsapp: field('shop_whatsapp')?.value ?? '',
          shop_address: field('shop_address')?.value ?? '',
          shop_instagram: field('shop_instagram')?.value ?? '',
        });
        saved('Dados da barbearia salvos.');
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('save-booking')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      setBusy(event.currentTarget, true);
      try {
        await api.put('/api/settings', {
          public_booking: plain('public_booking')?.checked ? '1' : '0',
          slot_interval: plain('slot_interval')?.value ?? '15',
          min_advance_minutes: plain('min_advance_minutes')?.value ?? '0',
          max_advance_days: plain('max_advance_days')?.value ?? '60',
        });
        saved('Configurações de agendamento salvas.');
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  const syncWeekdayRowState = (weekday: number): void => {
    const chk = content().querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="is_open"]`);
    const row = content().querySelector<HTMLElement>(`[data-hours-row="${weekday}"]`);
    const badge = content().querySelector<HTMLElement>(`[data-w-badge="${weekday}"]`);
    if (!chk) return;
    const open = chk.checked;
    if (row) row.style.opacity = open ? '1' : '0.65';
    if (badge) {
      badge.textContent = open ? 'Aberto' : 'Folga';
      badge.className = `pill ${open ? 'pill-confirmed' : 'pill-cancelled'}`;
    }
    content()
      .querySelectorAll<HTMLInputElement>(`[data-w="${weekday}"]:not([data-k="is_open"])`)
      .forEach((inp) => {
        inp.disabled = !open;
      });
  };

  [0, 1, 2, 3, 4, 5, 6].forEach((weekday) => {
    content()
      .querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="is_open"]`)
      ?.addEventListener('change', () => syncWeekdayRowState(weekday));
  });

  content()
    .querySelectorAll<HTMLElement>('[data-hours-preset]')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.hoursPreset;
        [0, 1, 2, 3, 4, 5, 6].forEach((weekday) => {
          const chk = content().querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="is_open"]`);
          if (!chk) return;
          if (preset === 'mon-sat') chk.checked = weekday >= 1 && weekday <= 6;
          else if (preset === 'tue-sat') chk.checked = weekday >= 2 && weekday <= 6;
          else if (preset === 'all-open') chk.checked = true;
          syncWeekdayRowState(weekday);
        });
        toast('Predefinição aplicada. Clique em "Salvar horários e folgas" para gravar.');
      });
    });

  plain<HTMLButtonElement>('save-hours')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        is_open: Boolean(
          content().querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="is_open"]`)?.checked
        ),
        open_time:
          content().querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="open_time"]`)?.value || '09:00',
        close_time:
          content().querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="close_time"]`)?.value || '19:00',
        break_start:
          content().querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="break_start"]`)?.value || null,
        break_end:
          content().querySelector<HTMLInputElement>(`[data-w="${weekday}"][data-k="break_end"]`)?.value || null,
      }));
      setBusy(event.currentTarget, true);
      try {
        await api.put('/api/business-hours', { days });
        saved('Horários e folgas semanais salvos com sucesso.');
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('add-closure')?.addEventListener('click', (event: MouseEvent) => {
    void submitShopClosure(
      plain('closure-date')?.value ?? '',
      plain('closure-reason')?.value || 'Folga',
      event.currentTarget,
      () => void refresh()
    );
  });

  plain<HTMLButtonElement>('quick-close-today')?.addEventListener('click', (event: MouseEvent) => {
    void submitShopClosure(
      today,
      plain('closure-reason')?.value || 'Folga hoje',
      event.currentTarget,
      () => void refresh()
    );
  });

  plain<HTMLButtonElement>('quick-close-tomorrow')?.addEventListener('click', (event: MouseEvent) => {
    void submitShopClosure(
      tomorrow,
      plain('closure-reason')?.value || 'Folga programada',
      event.currentTarget,
      () => void refresh()
    );
  });

  content()
    .querySelectorAll<HTMLElement>('[data-closure]')
    .forEach((element) =>
      element.addEventListener('click', () => {
        void (async () => {
          try {
            await api.del(`/api/closures/${element.dataset.closure}`);
            toast('Folga removida.');
            await refresh();
          } catch (error: unknown) {
            toast(errorMessage(error), 'error');
          }
        })();
      })
    );

  plain<HTMLButtonElement>('save-password')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      const current = plain('current_password')?.value ?? '';
      const next = plain('new_password')?.value ?? '';
      const confirmPw = plain('confirm_password')?.value ?? '';
      if (!current || !next) {
        toast('Preencha a senha atual e a nova senha.', 'error');
        return;
      }
      if (next !== confirmPw) {
        toast('A confirmação da nova senha não confere.', 'error');
        return;
      }
      if (next.length < 8) {
        toast('A nova senha deve ter ao menos 8 caracteres (maiúscula, minúscula e número).', 'error');
        return;
      }
      setBusy(event.currentTarget, true);
      try {
        await api.post('/api/settings/password', { current_password: current, new_password: next });
        const curEl = plain('current_password');
        const nextEl = plain('new_password');
        const confEl = plain('confirm_password');
        if (curEl) curEl.value = '';
        if (nextEl) nextEl.value = '';
        if (confEl) confEl.value = '';
        saved('Senha alterada com sucesso.');
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('logout-all-devices')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      const ok = await confirmDialog({
        title: 'Sair de todos os dispositivos',
        message: 'Todas as sessões ativas desta conta serão encerradas imediatamente.',
        confirmLabel: 'Encerrar sessões',
        danger: true,
      });
      if (!ok) return;
      setBusy(event.currentTarget, true);
      try {
        await api.post('/api/auth/logout-all', {});
        toast('Todas as sessões foram revogadas.', 'success');
        triggerLoginScreen();
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('setup-totp-btn')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      const box = document.getElementById('totp-setup-box');
      if (!box) return;
      setBusy(event.currentTarget, true);
      try {
        const res = await api.post<{ secret: string; otpauth_url: string }>('/api/auth/2fa/setup', {});
        box.classList.remove('hidden');
        box.innerHTML = `
          <div class="field">
            <label>Chave secreta (adicione no Google Authenticator / Authy)</label>
            <input class="control mono" readonly value="${esc(res.secret)}" />
          </div>
          <div class="row-actions" style="margin-top:8px">
            <input class="control mono" id="totp-verify-code" maxlength="6" inputmode="numeric" placeholder="Código de 6 dígitos" style="max-width:180px" />
            <button class="btn btn-primary btn-sm" id="confirm-enable-totp" type="button">Ativar 2FA</button>
          </div>`;
        document.getElementById('confirm-enable-totp')?.addEventListener('click', () => {
          void (async () => {
            const code = (document.getElementById('totp-verify-code') as HTMLInputElement | null)?.value.trim() ?? '';
            try {
              await api.post('/api/auth/2fa/enable', { code });
              state.me = await api.get<AuthMeResponse>('/api/auth/me');
              toast('Autenticação 2FA ativada com sucesso!', 'success');
              await refresh();
            } catch (err: unknown) {
              toast(errorMessage(err), 'error');
            }
          })();
        });
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('disable-totp-btn')?.addEventListener('click', () => {
    const modal = openModal({
      title: 'Desativar 2FA (TOTP)',
      narrow: true,
      body: `
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field">
            <label for="dis-totp-pw">Senha atual</label>
            <input class="control" type="password" id="dis-totp-pw" autocomplete="current-password" />
          </div>
          <div class="field">
            <label for="dis-totp-code">Código 2FA atual (6 dígitos)</label>
            <input class="control mono" id="dis-totp-code" maxlength="6" inputmode="numeric" placeholder="000000" />
          </div>
        </div>`,
    });
    modal.setFooter([
      button('Cancelar', () => modal.close(), 'btn btn-ghost'),
      button(
        'Desativar',
        async () => {
          const password = (document.getElementById('dis-totp-pw') as HTMLInputElement | null)?.value ?? '';
          const code = (document.getElementById('dis-totp-code') as HTMLInputElement | null)?.value.trim() ?? '';
          try {
            await api.post('/api/auth/2fa/disable', { password, code });
            state.me = await api.get<AuthMeResponse>('/api/auth/me');
            modal.close();
            toast('2FA desativado.', 'ok');
            await refresh();
          } catch (err: unknown) {
            toast(errorMessage(err), 'error');
          }
        },
        'btn btn-danger'
      ),
    ]);
  });

  plain<HTMLButtonElement>('save-templates')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      setBusy(event.currentTarget, true);
      try {
        await api.put('/api/settings', {
          whatsapp_message_confirmation: plain<HTMLTextAreaElement>('tpl_confirmation')?.value ?? '',
          whatsapp_message_reminder: plain<HTMLTextAreaElement>('tpl_reminder')?.value ?? '',
          whatsapp_message_cancellation: plain<HTMLTextAreaElement>('tpl_cancellation')?.value ?? '',
        });
        saved('Mensagens salvas.');
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('copy-link')?.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(publicLink);
        toast('Link copiado.');
      } catch {
        toast('Não foi possível copiar automaticamente.', 'error');
      }
    })();
  });

  plain<HTMLButtonElement>('save-whatsapp-cloud')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      setBusy(event.currentTarget, true);
      try {
        const payload: Record<string, string> = {
          whatsapp_cloud_enabled: plain('whatsapp_cloud_enabled')?.checked ? '1' : '0',
          whatsapp_phone_number_id: plain('whatsapp_phone_number_id')?.value.trim() ?? '',
          whatsapp_business_account_id: plain('whatsapp_business_account_id')?.value.trim() ?? '',
          whatsapp_api_version: plain('whatsapp_api_version')?.value.trim() ?? 'v21.0',
          whatsapp_admin_phone: plain('whatsapp_admin_phone')?.value.trim() ?? '',
          whatsapp_notify_admin: plain('whatsapp_notify_admin')?.checked ? '1' : '0',
          whatsapp_notify_barber: plain('whatsapp_notify_barber')?.checked ? '1' : '0',
          whatsapp_reminder_enabled: plain('whatsapp_reminder_enabled')?.checked ? '1' : '0',
          whatsapp_reminder_hours: plain('whatsapp_reminder_hours')?.value.trim() || '24',
          whatsapp_use_templates: plain('whatsapp_use_templates')?.checked ? '1' : '0',
          whatsapp_template_confirmation: plain('whatsapp_template_confirmation')?.value.trim() ?? '',
          whatsapp_template_reminder: plain('whatsapp_template_reminder')?.value.trim() ?? '',
          whatsapp_template_cancellation: plain('whatsapp_template_cancellation')?.value.trim() ?? '',
          whatsapp_template_reschedule: plain('whatsapp_template_reschedule')?.value.trim() ?? '',
        };
        const token = plain('whatsapp_access_token')?.value.trim() ?? '';
        if (token) payload['whatsapp_access_token'] = token;
        const webhookToken = plain('whatsapp_webhook_verify_token')?.value.trim() ?? '';
        if (webhookToken) payload['whatsapp_webhook_verify_token'] = webhookToken;

        await api.put('/api/settings', payload);
        saved('Configurações do WhatsApp Cloud salvas com sucesso.');
        await refresh();
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('trigger-reminders-now')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      setBusy(event.currentTarget, true);
      try {
        const res = await api.post<{ sent: number; scanned: number }>('/api/whatsapp/trigger-reminders', {});
        toast(`Verificação concluída: ${res.sent} enviados, ${res.scanned} agendamentos analisados.`);
        const updatedMessages = await api.get<WhatsAppMessage[]>('/api/whatsapp/messages?limit=25');
        const wrap = plain<HTMLElement>('whatsapp-history-wrap');
        if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('refresh-whatsapp-history')?.addEventListener('click', (event: MouseEvent) => {
    void (async () => {
      setBusy(event.currentTarget, true);
      try {
        const updatedMessages = await api.get<WhatsAppMessage[]>('/api/whatsapp/messages?limit=25');
        const wrap = plain<HTMLElement>('whatsapp-history-wrap');
        if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
        toast('Histórico atualizado.');
      } catch (error: unknown) {
        toast(errorMessage(error), 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    })();
  });

  plain<HTMLButtonElement>('test-whatsapp-cloud')?.addEventListener('click', () => {
    const defaultPhone = plain('whatsapp_admin_phone')?.value || plain('whatsapp_phone_number_id')?.value || '';
    const modalContent = document.createElement('div');
    modalContent.innerHTML = `
      <p class="muted" style="margin-bottom:12px; font-size:13px">
        O sistema enviará uma mensagem direta através da Meta WhatsApp Business Cloud API para o número especificado.
      </p>
      <div class="field" style="margin-bottom:12px">
        <label>Telefone do Destinatário (com DDD)</label>
        <input class="control" id="modal-test-phone" value="${esc(defaultPhone)}" placeholder="Ex: 11999998888" />
      </div>
      <div class="field" style="margin-bottom:14px">
        <label>Texto da Mensagem</label>
        <textarea class="control" id="modal-test-message" rows="3">Mensagem de teste oficial enviada via Meta WhatsApp Business Cloud API - Gestor de Barbearia.</textarea>
      </div>
      <div id="test-result-box" style="display:none; margin-bottom:14px; padding:10px; border-radius:6px; font-size:12px; font-family:monospace; white-space:pre-wrap; max-height:160px; overflow-y:auto"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px">
        <button class="btn btn-ghost" id="modal-test-cancel" type="button">Cancelar</button>
        <button class="btn btn-primary" id="modal-test-send" type="button">${icon('whatsapp')} Enviar Teste</button>
      </div>
    `;

    const modal = openModal({
      title: 'Testar Conexão com WhatsApp Meta',
      body: modalContent,
    });

    modalContent.querySelector('#modal-test-cancel')?.addEventListener('click', () => modal.close());
    modalContent.querySelector('#modal-test-send')?.addEventListener('click', (evt: Event) => {
      void (async () => {
        const phone = modalContent.querySelector<HTMLInputElement>('#modal-test-phone')?.value.trim() ?? '';
        const message = modalContent.querySelector<HTMLTextAreaElement>('#modal-test-message')?.value.trim() ?? '';
        const resultBox = modalContent.querySelector<HTMLElement>('#test-result-box');
        if (!phone) {
          toast('Informe o telefone de destino.', 'error');
          return;
        }

        setBusy(evt.currentTarget, true);
        if (resultBox) resultBox.style.display = 'none';
        try {
          const res = await api.post<{ meta_message_id?: string }>('/api/whatsapp/test', { phone, message });
          if (resultBox) {
            resultBox.style.display = 'block';
            resultBox.style.background = 'rgba(16, 185, 129, 0.1)';
            resultBox.style.color = '#34d399';
            resultBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            resultBox.textContent = `SUCESSO!\nID da Mensagem Meta: ${res.meta_message_id || 'OK'}\nResposta: ${JSON.stringify(res, null, 2)}`;
          }
          toast('Mensagem de teste enviada com sucesso!');
          const updatedMessages = await api.get<WhatsAppMessage[]>('/api/whatsapp/messages?limit=25');
          const wrap = plain<HTMLElement>('whatsapp-history-wrap');
          if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
        } catch (err: unknown) {
          if (resultBox) {
            resultBox.style.display = 'block';
            resultBox.style.background = 'rgba(239, 68, 68, 0.1)';
            resultBox.style.color = '#f87171';
            resultBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            const details = err instanceof ApiError && err.details ? JSON.stringify(err.details, null, 2) : '';
            resultBox.textContent = `FALHA NO ENVIO:\n${errorMessage(err)}\n${details}`;
          }
          toast(errorMessage(err), 'error');
        } finally {
          setBusy(evt.currentTarget, false);
        }
      })();
    });
  });

  plain<HTMLElement>('whatsapp-history-wrap')?.addEventListener('click', (e: MouseEvent) => {
    const resendBtn = (e.target as HTMLElement | null)?.closest?.('.resend-wa-btn') as HTMLElement | null;
    if (!resendBtn) return;
    const msgId = resendBtn.dataset.id;
    if (!msgId) return;
    void (async () => {
      setBusy(resendBtn, true);
      try {
        await api.post(`/api/whatsapp/resend/${msgId}`, {});
        toast('Tentativa de reenvio realizada.');
        const updatedMessages = await api.get<WhatsAppMessage[]>('/api/whatsapp/messages?limit=25');
        const wrap = plain<HTMLElement>('whatsapp-history-wrap');
        if (wrap) wrap.innerHTML = renderWhatsAppHistoryTable(updatedMessages);
      } catch (err: unknown) {
        toast(errorMessage(err), 'error');
      } finally {
        setBusy(resendBtn, false);
      }
    })();
  });
}

