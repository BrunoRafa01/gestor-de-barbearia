// Rotas de Conformidade LGPD, Direitos dos Titulares (DSR),
// Gestao de Consentimento e Auditoria de Seguranca.

import { isAuthenticated } from '../auth.js';
import { all, get, run } from '../db.js';
import { runComplianceAudit } from '../compliance.js';
import { HttpError, readJsonBody } from '../http.js';
import {
  anonymizeIp,
  clientIp,
  dsrLimiter,
  getSecurityLogs,
  logSecurityEvent,
  publicReadLimiter,
  sanitizeInput,
} from '../security.js';

let complianceAuditCache = null;
let complianceAuditCacheAt = 0;

export const lgpdRoutes = [
  /**
   * [Requisito 18: Execucao de Dados / Portabilidade]
   * Exporta todos os dados pessoais e historico de agendamentos associados ao telefone
   * em formato JSON legivel por maquina.
   */
  {
    method: 'GET',
    path: '/api/lgpd/export',
    auth: false,
    handler: async ({ req, query }) => {
      const ip = clientIp(req);
      const limitCheck = dsrLimiter.check(ip);
      if (!limitCheck.allowed) {
        throw new HttpError(429, limitCheck.message);
      }

      const rawPhone = query?.phone;
      if (!rawPhone) {
        throw new HttpError(400, 'Informe o numero de telefone para localizar seus dados.');
      }

      const cleanPhone = String(rawPhone).replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        throw new HttpError(400, 'Telefone invalido.');
      }

      // Exige sessao administrativa OU token valido de agendamento pertencente ao titular
      if (!isAuthenticated(req)) {
        const token = String(query?.token || '').trim();
        if (!/^[a-f0-9]{16,64}$/i.test(token)) {
          throw new HttpError(401, 'Informe o codigo do seu agendamento (token) ou autentique-se como administrador para exportar dados.');
        }
        const owned = await get(
          `SELECT a.id FROM appointments a
           JOIN clients c ON c.id = a.client_id
           WHERE a.cancel_token = ? AND REPLACE(REPLACE(REPLACE(REPLACE(c.phone, '-', ''), '(', ''), ')', ''), ' ', '') = ?`,
          [token, cleanPhone]
        );
        if (!owned) {
          throw new HttpError(403, 'Codigo de agendamento nao corresponde ao telefone informado.');
        }
      }

      const client = await get(
        "SELECT id, name, phone, email, notes, created_at FROM clients WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), '(', ''), ')', ''), ' ', '') = ?",
        [cleanPhone]
      );

      const appointments = await all(
        `SELECT a.id, c.name AS client_name, c.phone AS client_phone, s.name AS service_name, b.name AS barber_name, a.price, a.date, a.start_time, a.end_time, a.status, a.created_at
         FROM appointments a
         JOIN clients c ON c.id = a.client_id
         LEFT JOIN services s ON s.id = a.service_id
         LEFT JOIN barbers b ON b.id = a.barber_id
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(c.phone, '-', ''), '(', ''), ')', ''), ' ', '') = ?
         ORDER BY a.date DESC`,
        [cleanPhone]
      );

      logSecurityEvent('DSR_DATA_EXPORT', { phone_anonymized: cleanPhone.slice(0, 4) + '****' + cleanPhone.slice(-2), total_records: appointments.length }, req);

      return {
        status: 200,
        body: {
          success: true,
          titular: client || { phone: cleanPhone, notice: 'Cadastro principal nao localizado; historico de agendamentos anexado abaixo.' },
          agendamentos: appointments,
          timestamp_exportacao: new Date().toISOString(),
          base_legal: 'Art. 18, V da Lei 13.709/2018 (Portabilidade dos dados)',
          retencao_info: 'Dados mantidos pelo periodo estritamente necessario para execucao dos servicos e cumprimento de obrigacao legal/fiscal.',
        },
      };
    },
  },

  /**
   * [Requisito 17: Direitos dos Titulares (DSR)]
   * Registra solicitacoes de titulares: Exclusao, Retificacao, Confirmacao ou Revogacao.
   */
  {
    method: 'POST',
    path: '/api/lgpd/request',
    auth: false,
    handler: async ({ req, body }) => {
      const ip = clientIp(req);
      const limitCheck = dsrLimiter.check(ip);
      if (!limitCheck.allowed) {
        throw new HttpError(429, limitCheck.message);
      }

      const payload = body || {};
      const { name, phone, email, requestType, message } = payload;

      if (!phone || !requestType) {
        throw new HttpError(400, 'Telefone e Tipo de Requisicao sao obrigatorios.');
      }

      const cleanPhone = String(phone).replace(/\D/g, '');
      const validTypes = ['confirmacao', 'acesso', 'correcao', 'anonimizacao', 'exclusao', 'revogacao'];
      if (!validTypes.includes(requestType)) {
        throw new HttpError(400, `Tipo de solicitacao invalido. Opcoes validas: ${validTypes.join(', ')}`);
      }

      // Registra a solicitacao do titular
      const protocolNumber = `LGPD-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 899 + 100)}`;

      logSecurityEvent('DSR_REQUEST_CREATED', {
        protocolNumber,
        requestType,
        phone_anonymized: cleanPhone.slice(0, 4) + '****' + cleanPhone.slice(-2),
      }, req);

      return {
        status: 201,
        body: {
          success: true,
          protocolo: protocolNumber,
          mensagem: 'Sua solicitacao foi registrada com sucesso e sera processada pelo nosso Encarregado de Dados (DPO) no prazo de ate 15 dias, conforme Art. 19, II da LGPD.',
          tipo: requestType,
          contato_dpo: 'dpo@novaruntime.com.br',
        },
      };
    },
  },

  /**
   * [Requisito 15: Gestao de Consentimentos]
   * Registra a escolha de cookies e comunicacoes do titular.
   */
  {
    method: 'POST',
    path: '/api/lgpd/consent',
    auth: false,
    handler: async ({ req, body }) => {
      const ip = clientIp(req);
      const limitCheck = dsrLimiter.check(ip);
      if (!limitCheck.allowed) {
        throw new HttpError(429, limitCheck.message);
      }

      const payload = body || {};
      const { necessary, analytics, marketing, userToken } = payload;

      logSecurityEvent('CONSENT_PREFERENCES_UPDATED', {
        necessary: Boolean(necessary),
        analytics: Boolean(analytics),
        marketing: Boolean(marketing),
        tokenHash: userToken ? userToken.slice(0, 8) + '...' : 'anon',
      }, req);

      return {
        status: 200,
        body: {
          success: true,
          message: 'Preferencias de consentimento salvas com sucesso.',
          updatedAt: new Date().toISOString(),
        },
      };
    },
  },

  /**
   * [Requisito 40: Auditoria de Conformidade]
   * Validador em tempo real do status de conformidade dos 40 requisitos.
   */
  {
    method: 'GET',
    path: '/api/compliance/status',
    auth: false,
    handler: async ({ req, res }) => {
      const limit = publicReadLimiter.check(`compliance:${clientIp(req)}`);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        throw new HttpError(429, limit.message || 'Muitas requisicoes. Tente novamente em instantes.');
      }
      const now = Date.now();
      if (!complianceAuditCache || now - complianceAuditCacheAt > 60_000) {
        complianceAuditCache = runComplianceAudit();
        complianceAuditCacheAt = now;
      }
      return {
        status: 200,
        body: {
          success: true,
          ...complianceAuditCache,
        },
      };
    },
  },

  /**
   * [Requisito 33: Monitoramento de Seguranca]
   * Trilha de auditoria de seguranca para administradores autenticados.
   */
  {
    method: 'GET',
    path: '/api/admin/security-logs',
    auth: true,
    handler: async () => {
      const logs = getSecurityLogs(100);
      return {
        status: 200,
        body: {
          success: true,
          total: logs.length,
          logs,
        },
      };
    },
  },
];
