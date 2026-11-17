// Sistema de Auditoria & Radar Anti-BO em Tempo Real (Painel Master).
// Registra acoes de barbeiros, gestores e eventos de seguranca no banco de dados,
// classificando automaticamente anomalias ("BOs") como cancelamentos suspeitos,
// exclusoes de agendamentos/clientes, alteracoes de preco/comissao e acessos ao banco.

import { run } from './db.js';
import { anonymizeIp, clientIp } from './security.js';

/**
 * Classifica uma requisicao da API em rotulo legivel, nivel de risco e motivo de BO.
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.pathname
 * @param {any} opts.body
 * @param {number} opts.statusCode
 */
export function classifyAuditAction({ method, pathname, body = {}, statusCode = 200 }) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(pathname || '');

  // 1. Falhas de login ou bloqueio de seguranca
  if (p === '/api/auth/login' && statusCode >= 400) {
    return {
      action_label: 'Tentativa de login recusada',
      risk_level: 'critical_bo',
      bo_reason: `Falha de autenticação (${statusCode}) — possível tentativa de acesso indevido.`,
    };
  }

  if (p === '/api/auth/login' || p === '/api/auth/master-session') {
    return {
      action_label: p.includes('master') ? 'Acesso ao Painel Master' : 'Login no Painel da Barbearia',
      risk_level: 'normal',
      bo_reason: null,
    };
  }

  // 2. Agendamentos (Cancelamento, Falta ou Exclusao = Alerta de BO no caixa!)
  if (p.startsWith('/api/appointments')) {
    if (m === 'DELETE') {
      return {
        action_label: 'Agendamento APAGADO do banco',
        risk_level: 'critical_bo',
        bo_reason:
          'Exclusão direta de agendamento — verifique se o corte foi realizado por fora do sistema sem lançar comissão.',
      };
    }
    if ((m === 'PUT' || m === 'PATCH') && (body?.status === 'cancelled' || body?.status === 'no_show')) {
      const tipo = body.status === 'cancelled' ? 'Cancelado' : 'Marcado como Falta (No-Show)';
      return {
        action_label: `Agendamento ${tipo}`,
        risk_level: 'critical_bo',
        bo_reason: `Status alterado para "${tipo}" — auditar se o cliente realmente faltou ou se foi atendido sem registro no caixa.`,
      };
    }
    if ((m === 'PUT' || m === 'PATCH') && body?.price !== undefined) {
      return {
        action_label: `Valor de agendamento alterado (R$ ${Number(body.price || 0).toFixed(2)})`,
        risk_level: 'warning',
        bo_reason: 'Preço individual do agendamento modificado manualmente.',
      };
    }
    if (m === 'POST') {
      return {
        action_label: 'Novo agendamento registrado',
        risk_level: 'normal',
        bo_reason: null,
      };
    }
    return {
      action_label: 'Atualização de agendamento',
      risk_level: 'normal',
      bo_reason: null,
    };
  }

  // 3. Profissionais / Barbeiros (Comissao ou Exclusao)
  if (p.startsWith('/api/barbers')) {
    if (m === 'DELETE') {
      return {
        action_label: 'Barbeiro removido',
        risk_level: 'critical_bo',
        bo_reason: 'Exclusão de perfil de barbeiro do banco de dados.',
      };
    }
    if ((m === 'PUT' || m === 'PATCH') && body?.commission !== undefined) {
      return {
        action_label: `Comissão de barbeiro alterada (${body.commission}%)`,
        risk_level: 'warning',
        bo_reason: `Percentual de comissão modificado para ${body.commission}% (${body.name || 'barbeiro'}).`,
      };
    }
    return {
      action_label: m === 'POST' ? 'Novo barbeiro cadastrado' : 'Dados de barbeiro editados',
      risk_level: 'normal',
      bo_reason: null,
    };
  }

  // 4. Servicos (Alteracao de Preco ou Exclusao)
  if (p.startsWith('/api/services')) {
    if (m === 'DELETE') {
      return {
        action_label: 'Serviço excluído do catálogo',
        risk_level: 'warning',
        bo_reason: 'Remoção de serviço do catálogo.',
      };
    }
    if ((m === 'PUT' || m === 'PATCH') && body?.price !== undefined) {
      return {
        action_label: `Preço de serviço alterado (${body.name || 'Serviço'} → R$ ${Number(body.price || 0).toFixed(2)})`,
        risk_level: 'warning',
        bo_reason: 'Alteração de tabela de preços.',
      };
    }
    return {
      action_label: m === 'POST' ? 'Novo serviço criado' : 'Serviço atualizado',
      risk_level: 'normal',
      bo_reason: null,
    };
  }

  // 5. Clientes (Exclusao)
  if (p.startsWith('/api/clients')) {
    if (m === 'DELETE') {
      return {
        action_label: 'Ficha de cliente apagada',
        risk_level: 'critical_bo',
        bo_reason: 'Cliente e histórico foram removidos manualmente.',
      };
    }
    return {
      action_label: m === 'POST' ? 'Novo cliente cadastrado' : 'Ficha de cliente editada',
      risk_level: 'normal',
      bo_reason: null,
    };
  }

  // 6. Despesas / Saidas de Caixa
  if (p.startsWith('/api/expenses')) {
    return {
      action_label:
        m === 'DELETE'
          ? 'Despesa removida do financeiro'
          : `Saída de caixa lançada (${body?.description || 'Despesa'} · R$ ${Number(body?.amount || 0).toFixed(2)})`,
      risk_level: m === 'DELETE' || Number(body?.amount || 0) >= 200 ? 'warning' : 'normal',
      bo_reason:
        m === 'DELETE'
          ? 'Exclusão de lançamento financeiro.'
          : Number(body?.amount || 0) >= 200
            ? 'Saída de caixa de valor elevado registrada.'
            : null,
    };
  }

  // 7. Folgas, Feriados e Horarios
  if (p.startsWith('/api/closures') || p.startsWith('/api/settings/hours')) {
    return {
      action_label: p.startsWith('/api/closures')
        ? m === 'DELETE'
          ? 'Folga/Feriado removido'
          : `Dia fechado / Folga cadastrada (${body?.date || ''})`
        : 'Horário de funcionamento / Folga semanal alterado',
      risk_level: 'warning',
      bo_reason: body?.force
        ? 'Fechamento de dia com cancelamento em lote de agendamentos ativos.'
        : 'Alteração na grade de abertura da barbearia.',
    };
  }

  // 8. Banco de Dados & Backup
  if (p.startsWith('/api/backup')) {
    if (p.includes('restore') || m === 'POST') {
      return {
        action_label: 'RESTAURAÇÃO / SOBRESCRITA DO BANCO DE DADOS',
        risk_level: 'critical_bo',
        bo_reason: 'O banco de dados inteiro foi restaurado a partir de um arquivo externo.',
      };
    }
    return {
      action_label: 'Download de Backup do Banco de Dados',
      risk_level: 'warning',
      bo_reason: 'Cópia integral do banco de dados exportada.',
    };
  }

  // 9. Alteracao de Senha / Configuracoes
  if (p.startsWith('/api/settings')) {
    if (p.includes('password')) {
      return {
        action_label: 'Senha administrativa alterada',
        risk_level: 'critical_bo',
        bo_reason: 'Credencial de acesso ao painel foi modificada.',
      };
    }
    return {
      action_label: 'Configurações da barbearia atualizadas',
      risk_level: 'normal',
      bo_reason: null,
    };
  }

  // 10. Agendamento Publico
  if (p === '/api/public/book' && m === 'POST') {
    return {
      action_label: `Reserva online pelo cliente (${body?.client_name || 'Cliente'})`,
      risk_level: 'normal',
      bo_reason: null,
    };
  }
  if (p.startsWith('/api/public/appointment/') && p.endsWith('/cancel')) {
    return {
      action_label: 'Cancelamento pelo próprio cliente (link público)',
      risk_level: 'warning',
      bo_reason: 'Cliente cancelou o horário pelo link de autoatendimento.',
    };
  }

  return {
    action_label: `${m} ${p}`,
    risk_level: statusCode >= 400 ? 'warning' : 'normal',
    bo_reason: statusCode >= 400 ? `Resposta HTTP ${statusCode}` : null,
  };
}

/**
 * Grava um evento na tabela `audit_events` sem interromper o fluxo principal.
 */
export async function recordAuditEvent({
  req,
  session,
  shopId = 1,
  method,
  pathname,
  body = {},
  statusCode = 200,
  customLabel = null,
  customRisk = null,
  customReason = null,
}) {
  try {
    const classified = classifyAuditAction({ method, pathname, body, statusCode });
    const safeBody = { ...body };
    delete safeBody.password;
    delete safeBody.current_password;
    delete safeBody.new_password;
    delete safeBody.whatsapp_access_token;

    const summary = Object.keys(safeBody).length
      ? JSON.stringify(safeBody).slice(0, 420)
      : null;

    const ip = req ? anonymizeIp(clientIp(req)) : 'local';
    const actor = session?.sub || (pathname.startsWith('/api/public') ? 'cliente-publico' : 'admin');
    const actorRole = session?.role || (pathname.startsWith('/api/public') ? 'public' : 'owner');

    await run(
      `INSERT INTO audit_events
         (shop_id, actor, actor_role, method, path, action_label, risk_level, bo_reason, payload_summary, status_code, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(shopId) || 1,
        String(actor),
        String(actorRole),
        String(method || 'GET').toUpperCase(),
        String(pathname || '/'),
        customLabel || classified.action_label,
        customRisk || classified.risk_level,
        customReason !== null ? customReason : classified.bo_reason,
        summary,
        Number(statusCode) || 200,
        ip,
      ]
    );
  } catch {
    // Falha silenciosa para nunca quebrar a requisicao principal
  }
}
