// Rotas exclusivas do Painel Master (Torre de Controle & Radar Anti-BO) da Nova Runtime.
// Permite ao dono do sistema monitorar:
//   1. Trilha de Auditoria & Radar Anti-BO (acoes de barbeiros, cancelamentos suspeitos, exclusoes)
//   2. Inspetor de Banco de Dados em Tempo Real (tabelas, contagem de linhas e registros brutos)
//   3. Integridade do Codigo-Fonte & Runtime (status do Git, arquivos modificados e hashes SHA-256)
//   4. Gestao de Barbearias, Barbeiros e Planos SaaS

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordAuditEvent } from '../audit.js';
import { all, driverKind, get, healthCheck, run } from '../db.js';
import { HttpError } from '../http.js';
import { setShopPlan } from '../plans.js';
import { requiredId } from '../validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');

const ALLOWED_INSPECT_TABLES = new Set([
  'barbershops',
  'users',
  'barbers',
  'services',
  'clients',
  'appointments',
  'closures',
  'expenses',
  'whatsapp_messages',
  'audit_events',
]);

const CRITICAL_SOURCE_FILES = [
  'server/server.js',
  'server/db.js',
  'server/auth.js',
  'server/audit.js',
  'server/routes/master.routes.js',
  'public/js/app.js',
  'public/js/agendar.js',
];

function requireMaster(session, req) {
  const isDemoConsole =
    process.env.NODE_ENV !== 'production' &&
    process.env.DEMO_MODE === '1' &&
    req?.headers?.['x-master-console'] === '1';

  if ((!session || session.role !== 'master') && !isDemoConsole) {
    throw new HttpError(403, 'Acesso restrito a administradores master da Nova Runtime.');
  }
}

function safeGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export const masterRoutes = [
  {
    method: 'GET',
    path: '/api/master/overview',
    handler: async ({ req, session }) => {
      requireMaster(session, req);
      const [shopStats, apptStats, planRows, dbHealth, auditCounts] = await Promise.all([
        get(
          `SELECT COUNT(*) AS total_shops,
                  COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active_shops,
                  COALESCE(SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END), 0) AS suspended_shops
             FROM barbershops`,
          []
        ),
        get(
          `SELECT COUNT(*) AS total_appointments,
                  COALESCE(SUM(CASE WHEN status = 'completed' THEN price ELSE 0 END), 0) AS platform_gmv,
                  COALESCE(SUM(CASE WHEN status IN ('cancelled', 'no_show') THEN 1 ELSE 0 END), 0) AS cancelled_or_noshow
             FROM appointments`,
          []
        ),
        all(
          `SELECT COALESCE(s.plan_id, 'free') AS plan_id, COUNT(*) AS total
             FROM barbershops b
             LEFT JOIN subscriptions s ON s.shop_id = b.id
            GROUP BY COALESCE(s.plan_id, 'free')`,
          []
        ),
        healthCheck(),
        get(
          `SELECT COUNT(*) AS total_events,
                  COALESCE(SUM(CASE WHEN risk_level = 'critical_bo' THEN 1 ELSE 0 END), 0) AS critical_bo,
                  COALESCE(SUM(CASE WHEN risk_level = 'warning' THEN 1 ELSE 0 END), 0) AS warnings
             FROM audit_events`,
          []
        ),
      ]);

      return {
        status: 200,
        body: {
          platform: 'Nova Runtime',
          driver: driverKind(),
          database: dbHealth,
          shops: {
            total: Number(shopStats?.total_shops || 0),
            active: Number(shopStats?.active_shops || 0),
            suspended: Number(shopStats?.suspended_shops || 0),
          },
          appointments: {
            total: Number(apptStats?.total_appointments || 0),
            gmv: Number(apptStats?.platform_gmv || 0),
            cancelled_or_noshow: Number(apptStats?.cancelled_or_noshow || 0),
          },
          audit: {
            total: Number(auditCounts?.total_events || 0),
            critical_bo: Number(auditCounts?.critical_bo || 0),
            warnings: Number(auditCounts?.warnings || 0),
          },
          plans: planRows.map((r) => ({ plan_id: r.plan_id, total: Number(r.total) })),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/master/shops',
    handler: async ({ req, session }) => {
      requireMaster(session, req);
      const rows = await all(
        `SELECT b.id, b.slug, b.name, b.company, b.active, b.created_at,
                COALESCE(s.plan_id, 'free') AS plan_id,
                COALESCE(s.status, 'active') AS subscription_status,
                (SELECT COUNT(*) FROM users u WHERE u.shop_id = b.id AND u.active = 1) AS users_count,
                (SELECT COUNT(*) FROM barbers br WHERE br.shop_id = b.id AND br.active = 1) AS barbers_count,
                (SELECT COUNT(*) FROM appointments a WHERE a.shop_id = b.id) AS appointments_count,
                (SELECT COUNT(*) FROM appointments a WHERE a.shop_id = b.id AND a.status IN ('cancelled','no_show')) AS bo_cancelled_count
           FROM barbershops b
           LEFT JOIN subscriptions s ON s.shop_id = b.id
          ORDER BY b.id ASC`,
        []
      );
      return {
        status: 200,
        body: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          active: Number(row.active) === 1,
          users_count: Number(row.users_count || 0),
          barbers_count: Number(row.barbers_count || 0),
          appointments_count: Number(row.appointments_count || 0),
          bo_cancelled_count: Number(row.bo_cancelled_count || 0),
        })),
      };
    },
  },
  {
    method: 'PATCH',
    path: '/api/master/shops/:id',
    handler: async ({ req, params, body, session }) => {
      requireMaster(session, req);
      const id = requiredId(params.id, 'barbearia');
      const shop = await get('SELECT * FROM barbershops WHERE id = ?', [id]);
      if (!shop) throw new HttpError(404, 'Barbearia nao encontrada.');

      if (body.active !== undefined) {
        const nextActive = body.active ? 1 : 0;
        await run('UPDATE barbershops SET active = ? WHERE id = ?', [nextActive, id]);
      }

      if (body.plan_id) {
        await setShopPlan(id, String(body.plan_id), { provider: 'master-admin' });
      }

      const updated = await get(
        `SELECT b.*, COALESCE(s.plan_id, 'free') AS plan_id, COALESCE(s.status, 'active') AS subscription_status
           FROM barbershops b
           LEFT JOIN subscriptions s ON s.shop_id = b.id
          WHERE b.id = ?`,
        [id]
      );
      return {
        status: 200,
        body: { ...updated, id: Number(updated.id), active: Number(updated.active) === 1 },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/master/logs',
    handler: async ({ req, session }) => {
      requireMaster(session, req);
      const [recentShops, recentMessages, recentAudit] = await Promise.all([
        all('SELECT id, slug, name, active, created_at FROM barbershops ORDER BY id DESC LIMIT 15', []),
        all(
          'SELECT id, message_type AS type, status, created_at FROM whatsapp_messages ORDER BY id DESC LIMIT 20',
          []
        ),
        all(
          'SELECT id, actor, actor_role, method, path, action_label, risk_level, bo_reason, status_code, created_at FROM audit_events ORDER BY id DESC LIMIT 40',
          []
        ),
      ]);
      return {
        status: 200,
        body: { recent_shops: recentShops, recent_messages: recentMessages, audit_events: recentAudit },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/master/audit',
    handler: async ({ req, query, session }) => {
      requireMaster(session, req);
      const filter = String(query?.risk || 'all');
      const whereClause =
        filter === 'critical_bo'
          ? "WHERE risk_level = 'critical_bo'"
          : filter === 'warning'
            ? "WHERE risk_level IN ('critical_bo', 'warning')"
            : '';

      const [events, barberAnomalies] = await Promise.all([
        all(
          `SELECT id, shop_id, actor, actor_role, method, path, action_label, risk_level, bo_reason, payload_summary, status_code, ip_hash, created_at
             FROM audit_events
             ${whereClause}
            ORDER BY id DESC
            LIMIT 80`,
          []
        ),
        all(
          `SELECT br.id, br.name, br.commission, br.active,
                  COUNT(a.id) AS total_appts,
                  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
                  COALESCE(SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
                  COALESCE(SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END), 0) AS noshow_count,
                  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price ELSE 0 END), 0) AS total_revenue,
                  COALESCE(SUM(CASE WHEN a.status IN ('cancelled','no_show') THEN a.price ELSE 0 END), 0) AS lost_revenue
             FROM barbers br
             LEFT JOIN appointments a ON a.barber_id = br.id
            GROUP BY br.id
            ORDER BY cancelled_count DESC, noshow_count DESC`,
          []
        ),
      ]);

      return {
        status: 200,
        body: {
          events,
          barber_anomalies: barberAnomalies.map((b) => {
            const total = Number(b.total_appts || 0);
            const bad = Number(b.cancelled_count || 0) + Number(b.noshow_count || 0);
            const boRate = total > 0 ? Math.round((bad / total) * 100) : 0;
            return {
              id: Number(b.id),
              name: b.name,
              commission: Number(b.commission || 0),
              active: Number(b.active) === 1,
              total_appts: total,
              completed_count: Number(b.completed_count || 0),
              cancelled_count: Number(b.cancelled_count || 0),
              noshow_count: Number(b.noshow_count || 0),
              total_revenue: Number(b.total_revenue || 0),
              lost_revenue: Number(b.lost_revenue || 0),
              bo_rate: boRate,
              suspect_flag: boRate >= 25 || bad >= 3,
            };
          }),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/master/simulate-bo',
    handler: async ({ req, session }) => {
      requireMaster(session, req);
      const scenarios = [
        {
          actor: 'barbeiro.carlos@barbearia.local',
          method: 'DELETE',
          pathname: '/api/appointments/48',
          customLabel: 'Agendamento APAGADO após horário do corte (Cadeira 02)',
          customRisk: 'critical_bo',
          customReason:
            'ALERTA DE BO: Agendamento de R$ 85,00 (Corte + Barba) apagado 12 min após o término — provável recebimento por fora do caixa sem repassar comissão.',
          body: { appointment_id: 48, service: 'Combo Corte + Barba', price: 85, barber: 'Carlos' },
        },
        {
          actor: 'barbeiro.lucas@barbearia.local',
          method: 'PUT',
          pathname: '/api/services/2',
          customLabel: 'Alteração suspeita de preço de serviço (R$ 55,00 → R$ 20,00)',
          customRisk: 'critical_bo',
          customReason:
            'ALERTA DE BO: Redução abrupta de 63% no valor do serviço no catálogo para reduzir base de cálculo de comissão.',
          body: { service_id: 2, old_price: 55, new_price: 20 },
        },
        {
          actor: 'desconhecido@ip-externo',
          method: 'POST',
          pathname: '/api/auth/login',
          customLabel: 'Tentativa bloqueada de acesso ao banco/painel (Senha Incorreta)',
          customRisk: 'critical_bo',
          customReason: 'ALERTA DE SEGURANÇA: 4 tentativas seguidas de login com senha inválida bloqueadas.',
          body: { email: 'admin@barbearia.com' },
        },
      ];
      const chosen = scenarios[Math.floor(Math.random() * scenarios.length)];
      await recordAuditEvent({
        req,
        session: { sub: chosen.actor, role: 'staff' },
        shopId: 1,
        method: chosen.method,
        pathname: chosen.pathname,
        body: chosen.body,
        statusCode: chosen.pathname.includes('login') ? 401 : 200,
        customLabel: chosen.customLabel,
        customRisk: chosen.customRisk,
        customReason: chosen.customReason,
      });

      return { status: 201, body: { ok: true, simulated: chosen.customLabel } };
    },
  },
  {
    method: 'GET',
    path: '/api/master/database',
    handler: async ({ req, session }) => {
      requireMaster(session, req);
      const tableNames = Array.from(ALLOWED_INSPECT_TABLES);
      const tableCounts = await Promise.all(
        tableNames.map(async (t) => {
          try {
            const row = await get(`SELECT COUNT(*) AS c FROM ${t}`, []);
            return { table: t, rows: Number(row?.c || 0) };
          } catch {
            return { table: t, rows: 0 };
          }
        })
      );

      const dbPath = resolve(ROOT_DIR, process.env.DATABASE_PATH || 'data/barbearia.db');
      let fileSizeBytes = 0;
      let lastModified = null;
      if (existsSync(dbPath)) {
        try {
          const st = statSync(dbPath);
          fileSizeBytes = st.size;
          lastModified = st.mtime.toISOString();
        } catch {}
      }

      const health = await healthCheck();
      return {
        status: 200,
        body: {
          driver: driverKind(),
          health,
          file_path: dbPath,
          file_size_bytes: fileSizeBytes,
          last_modified: lastModified,
          tables: tableCounts,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/master/database/:table',
    handler: async ({ req, params, session }) => {
      requireMaster(session, req);
      const table = String(params.table || '').trim();
      if (!ALLOWED_INSPECT_TABLES.has(table)) {
        throw new HttpError(400, 'Tabela nao autorizada para inspecao.');
      }

      const rows = await all(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 25`, []);
      const sanitizedRows = rows.map((r) => {
        const copy = { ...r };
        if ('password_hash' in copy) copy.password_hash = '[PROTEGIDO-SCRYPT]';
        if (copy.key === 'admin_password_hash' || copy.key === 'session_secret') {
          copy.value = '[SEGREDO-PROTEGIDO]';
        }
        return copy;
      });

      return {
        status: 200,
        body: {
          table,
          count: sanitizedRows.length,
          columns: sanitizedRows.length ? Object.keys(sanitizedRows[0]) : [],
          rows: sanitizedRows,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/master/integrity',
    handler: async ({ req, session }) => {
      requireMaster(session, req);

      const gitCommit = safeGit(['rev-parse', '--short', 'HEAD']) || 'desconhecido';
      const gitBranch = safeGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
      const gitLastMsg = safeGit(['log', '-1', '--format=%s (%cr)']) || '';
      const gitPorcelain = safeGit(['status', '--porcelain']);
      const modifiedFiles = gitPorcelain
        ? gitPorcelain
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
        : [];

      const checksums = CRITICAL_SOURCE_FILES.map((relPath) => {
        const full = resolve(ROOT_DIR, relPath);
        if (!existsSync(full)) {
          return { file: relPath, exists: false, sha256: null, size_bytes: 0, mtime: null };
        }
        const buf = readFileSync(full);
        const st = statSync(full);
        const sha256 = createHash('sha256').update(buf).digest('hex').slice(0, 16);
        return {
          file: relPath,
          exists: true,
          sha256,
          size_bytes: st.size,
          mtime: st.mtime.toISOString(),
        };
      });

      const mem = process.memoryUsage();
      return {
        status: 200,
        body: {
          git: {
            branch: gitBranch,
            commit: gitCommit,
            last_commit: gitLastMsg,
            clean: modifiedFiles.length === 0,
            modified_files: modifiedFiles,
          },
          files: checksums,
          runtime: {
            node_version: process.version,
            pid: process.pid,
            uptime_seconds: Math.round(process.uptime()),
            rss_mb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
            heap_used_mb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
          },
          security_controls: [
            { name: 'Sessão HMAC-SHA256 HttpOnly', active: true },
            { name: 'Hash de Senha Scrypt + Salt', active: true },
            { name: 'Trava Atômica SQLite/Turso Anti-Conflito', active: true },
            { name: 'Interceptor Anti-BO em Tempo Real', active: true },
            { name: 'Validação CSRF de Origem & CSP', active: true },
          ],
        },
      };
    },
  },
];
