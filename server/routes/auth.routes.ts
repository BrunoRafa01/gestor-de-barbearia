import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import {
  type AuthSessionPayload,
  endSession,
  hashPassword,
  isUsingDefaultPassword,
  passwordIssue,
  revokeUserSessions,
  startSession,
  validateActiveSession,
  verifyPassword,
} from '../auth.js';
import { get, getSetting, getSettingsMap, run, setSetting } from '../db.js';
import { isDemoMode } from '../demo.js';
import { HttpError, clearCookie, parseCookies, setCookie } from '../http.js';
import {
  OAUTH_STATE_COOKIE,
  authorizeGoogleUser,
  buildGoogleAuthUrl,
  createOAuthState,
  fetchGoogleUserInfo,
  isGoogleOAuthEnabled,
  verifyOAuthState,
} from '../oauth.js';
import { getShopPlan, listPlans, setShopPlan } from '../plans.js';
import {
  checkAccountLockout,
  clientIp,
  decryptSensitiveField,
  encryptSensitiveField,
  isSecureRequest,
  loginLimiter,
  logSecurityEvent,
  recordAccountLoginFailure,
  resetAccountLockout,
} from '../security.js';
import { buildOtpAuthUri, generateTotpSecret, verifyTotpCode } from '../totp.js';
import type { AppRequest, RouteContext, RouteDefinition } from '../types.js';
import { optionalEmail, requiredString } from '../validate.js';

async function isTotpEnabledForSubject(sub?: string | null): Promise<boolean> {
  const normalized = String(sub || 'admin').trim();
  if (!normalized || normalized === 'admin') {
    return getSetting('admin_totp_enabled', '0') === '1';
  }
  const user = await get('SELECT totp_enabled FROM users WHERE email = ?', [normalized]);
  return Number(user?.totp_enabled) === 1;
}

async function buildStatusPayload(
  session: AuthSessionPayload | null
): Promise<Record<string, unknown>> {
  const authenticated = Boolean(session);
  const payload: Record<string, unknown> = {
    authenticated,
    shop_name: getSetting('shop_name', 'Gestor de Barbearia'),
    company: getSetting('shop_company', 'Nova Runtime'),
    demo: isDemoMode(),
    oauth_providers: {
      google: isGoogleOAuthEnabled(),
    },
  };
  if (authenticated && session) {
    const totpEnabled = await isTotpEnabledForSubject(session.sub);
    payload.password_is_default = isUsingDefaultPassword();
    payload.is_master = session.role === 'master';
    payload.totp_enabled = totpEnabled;
    payload.totp_required = session.role === 'master';
    payload.mfa_verified = Boolean(session.mfa);
    payload.user = {
      email: session.sub || 'admin',
      role: session.role || 'owner',
      shop_id: Number(session.shop_id ?? session.shopId) || 1,
    };
  }
  return payload;
}

function redirectWithOAuthError(
  req: AppRequest,
  res: ServerResponse,
  message: string,
  status = 403
): null {
  if (String(req.headers.accept || '').includes('application/json')) {
    throw new HttpError(status, message);
  }
  res.writeHead(302, { Location: `/#login?oauth_error=${encodeURIComponent(message)}` });
  res.end();
  return null;
}

export const authRoutes: RouteDefinition[] = [
  {
    method: 'POST',
    path: '/api/auth/login',
    auth: false,
    handler: async ({ req, res, body }: RouteContext) => {
      const ip = clientIp(req);
      const ipKey = `login:${ip}`;
      const limit = loginLimiter.check(ipKey);

      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        logSecurityEvent('LOGIN_IP_RATE_LIMIT', {}, req);
        throw new HttpError(429, limit.message ?? 'Muitas tentativas de login.');
      }

      const password = requiredString(body.password, 'senha', { max: 128 });
      const email = optionalEmail(body.email);
      const accountKey = email ? email.toLowerCase() : '__local_admin__';

      const accountCheck = checkAccountLockout(accountKey);
      if (!accountCheck.allowed) {
        res.setHeader('Retry-After', String(accountCheck.retryAfterSeconds));
        logSecurityEvent('LOGIN_ACCOUNT_LOCKED', { account: accountKey }, req);
        throw new HttpError(429, accountCheck.message ?? 'Conta temporariamente bloqueada.');
      }

      if (email) {
        const user = await get('SELECT * FROM users WHERE email = ? AND active = 1', [email]);
        if (!user || !verifyPassword(password, user.password_hash)) {
          const afterFail = recordAccountLoginFailure(accountKey);
          logSecurityEvent('LOGIN_FAILED', { email, failures: afterFail.failures }, req);
          if (!afterFail.allowed) {
            res.setHeader('Retry-After', String(afterFail.retryAfterSeconds));
            throw new HttpError(429, afterFail.message ?? 'Conta temporariamente bloqueada.');
          }
          throw new HttpError(401, 'E-mail ou senha incorretos.');
        }

        let mfa = false;
        if (Number(user.totp_enabled) === 1 && user.totp_secret) {
          const totpCode = body.totp_code ?? body.code;
          if (!totpCode) {
            return {
              status: 401,
              body: {
                error: 'Informe o codigo de autenticacao em duas etapas (2FA).',
                requires_2fa: true,
              },
            };
          }
          const secret = decryptSensitiveField(String(user.totp_secret));
          if (!verifyTotpCode(secret, totpCode)) {
            const afterFail = recordAccountLoginFailure(accountKey);
            logSecurityEvent('LOGIN_2FA_FAILED', { email, failures: afterFail.failures }, req);
            if (!afterFail.allowed) {
              res.setHeader('Retry-After', String(afterFail.retryAfterSeconds));
              throw new HttpError(429, afterFail.message ?? 'Conta temporariamente bloqueada.');
            }
            throw new HttpError(401, 'Codigo 2FA invalido ou expirado.');
          }
          mfa = true;
        }

        loginLimiter.reset(ipKey);
        resetAccountLockout(accountKey);

        const userEmail = String(user.email || email);
        const userShopId = Number(user.shop_id) || 1;
        const userRole = String(user.role || 'owner');
        const userVer = Number(user.session_version ?? 1) || 1;

        startSession(res, {
          secure: isSecureRequest(req),
          sub: userEmail,
          shopId: userShopId,
          role: userRole,
          ver: userVer,
          mfa,
        });
        logSecurityEvent('LOGIN_SUCCESS', { email: userEmail, mfa }, req);

        const issuedSession: AuthSessionPayload = {
          sub: userEmail,
          shop_id: userShopId,
          shopId: userShopId,
          role: userRole,
          ver: userVer,
          mfa,
          iat: Date.now(),
          exp: Date.now() + 86_400_000,
        };
        return {
          status: 200,
          body: {
            ...(await buildStatusPayload(issuedSession)),
            shop_id: userShopId,
            role: userRole,
            user: userEmail,
          },
        };
      }

      const stored = getSetting('admin_password_hash');
      if (!verifyPassword(password, stored)) {
        const afterFail = recordAccountLoginFailure(accountKey);
        logSecurityEvent('LOGIN_FAILED', { account: 'admin', failures: afterFail.failures }, req);
        if (!afterFail.allowed) {
          res.setHeader('Retry-After', String(afterFail.retryAfterSeconds));
          throw new HttpError(429, afterFail.message ?? 'Conta temporariamente bloqueada.');
        }
        throw new HttpError(401, 'Senha incorreta.');
      }

      let mfa = false;
      const adminTotpEnabled = getSetting('admin_totp_enabled', '0') === '1';
      const adminTotpSecretEnc = getSetting('admin_totp_secret', '');
      if (adminTotpEnabled && adminTotpSecretEnc) {
        const totpCode = body.totp_code ?? body.code;
        if (!totpCode) {
          return {
            status: 401,
            body: {
              error: 'Informe o codigo de autenticacao em duas etapas (2FA).',
              requires_2fa: true,
            },
          };
        }
        const secret = decryptSensitiveField(adminTotpSecretEnc);
        if (!verifyTotpCode(secret, totpCode)) {
          const afterFail = recordAccountLoginFailure(accountKey);
          logSecurityEvent('LOGIN_2FA_FAILED', { account: 'admin', failures: afterFail.failures }, req);
          if (!afterFail.allowed) {
            res.setHeader('Retry-After', String(afterFail.retryAfterSeconds));
            throw new HttpError(429, afterFail.message ?? 'Conta temporariamente bloqueada.');
          }
          throw new HttpError(401, 'Codigo 2FA invalido ou expirado.');
        }
        mfa = true;
      }

      loginLimiter.reset(ipKey);
      resetAccountLockout(accountKey);
      const adminVer = Number(getSetting('session_version', '1')) || 1;
      startSession(res, { secure: isSecureRequest(req), ver: adminVer, mfa });
      logSecurityEvent('LOGIN_SUCCESS', { account: 'admin', mfa }, req);

      const issuedAdminSession: AuthSessionPayload = {
        sub: 'admin',
        shop_id: 1,
        shopId: 1,
        role: 'owner',
        ver: adminVer,
        mfa,
        iat: Date.now(),
        exp: Date.now() + 86_400_000,
      };
      return { status: 200, body: await buildStatusPayload(issuedAdminSession) };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/register-shop',
    auth: false,
    handler: async ({ req, res, body }: RouteContext) => {
      const ip = clientIp(req);
      const limit = loginLimiter.check(`register:${ip}`);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        throw new HttpError(429, limit.message ?? 'Muitas tentativas.');
      }

      const shopName = requiredString(body.shop_name, 'nome da barbearia', { max: 120 });
      const ownerName = requiredString(body.name, 'seu nome', { max: 120 });
      const email = optionalEmail(body.email);
      if (!email) throw new HttpError(400, 'Informe um e-mail valido.');
      const password = requiredString(body.password, 'senha', { max: 128 });
      const issue = passwordIssue(password);
      if (issue) throw new HttpError(400, issue);

      const baseSlug =
        shopName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'barbearia';
      const slug = `${baseSlug}-${randomBytes(2).toString('hex')}`;

      const existingUser = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (existingUser) throw new HttpError(409, 'Ja existe uma conta cadastrada com este e-mail.');

      const shopInfo = await run(
        'INSERT INTO barbershops (slug, name, company, active) VALUES (?, ?, ?, 1)',
        [slug, shopName, shopName]
      );
      const shopId = Number(shopInfo.lastInsertRowid);
      await run(
        'INSERT INTO users (shop_id, email, name, password_hash, role, active, session_version) VALUES (?, ?, ?, ?, ?, 1, 1)',
        [shopId, email, ownerName, hashPassword(password), 'owner']
      );
      await setShopPlan(shopId, 'free', { provider: 'onboarding' });

      startSession(res, {
        secure: isSecureRequest(req),
        sub: email,
        shopId,
        role: 'owner',
        ver: 1,
      });

      return {
        status: 201,
        body: {
          authenticated: true,
          shop: { id: shopId, slug, name: shopName },
          user: { email, name: ownerName, role: 'owner', shop_id: shopId },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    auth: false,
    handler: async ({ req, res }: RouteContext) => {
      const active = await validateActiveSession(req);
      if (active) {
        await revokeUserSessions(active.sub);
        logSecurityEvent('LOGOUT', { sub: active.sub }, req);
      }
      endSession(res, { secure: isSecureRequest(req) });
      return { status: 200, body: { authenticated: false } };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/logout-all',
    handler: async ({ req, res, session }: RouteContext) => {
      const sub = session?.sub || 'admin';
      const nextVer = await revokeUserSessions(sub);
      logSecurityEvent('LOGOUT_ALL_DEVICES', { sub, session_version: nextVer }, req);
      endSession(res, { secure: isSecureRequest(req) });
      return { status: 200, body: { revoked: true, authenticated: false, session_version: nextVer } };
    },
  },
  {
    method: 'GET',
    path: '/api/auth/me',
    auth: false,
    handler: async ({ req, res }: RouteContext) => {
      const session = await validateActiveSession(req, res);
      return {
        status: 200,
        body: await buildStatusPayload(session),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/auth/2fa/status',
    handler: async ({ session }: RouteContext) => {
      const sub = session?.sub || 'admin';
      const enabled = await isTotpEnabledForSubject(sub);
      return {
        status: 200,
        body: {
          enabled,
          required: session?.role === 'master',
          mfa_verified: Boolean(session?.mfa),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/2fa/setup',
    handler: async ({ req, session }: RouteContext) => {
      const sub = String(session?.sub || 'admin');
      const secret = generateTotpSecret();
      const encrypted = encryptSensitiveField(secret);

      if (sub === 'admin') {
        await setSetting('admin_totp_pending_secret', encrypted);
      } else {
        await run('UPDATE users SET totp_pending_secret = ? WHERE email = ?', [encrypted, sub]);
      }

      const otpauthUrl = buildOtpAuthUri({
        secret,
        accountName: sub,
        issuer: getSetting('shop_name', 'Gestor de Barbearia'),
      });
      logSecurityEvent('TOTP_2FA_SETUP_STARTED', { sub }, req);
      return {
        status: 200,
        body: {
          secret,
          otpauth_url: otpauthUrl,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/2fa/enable',
    handler: async ({ req, res, body, session }: RouteContext) => {
      const sub = String(session?.sub || 'admin');
      const code = requiredString(body.code, 'codigo 2FA', { max: 12 });

      let pendingEnc: string;
      if (sub === 'admin') {
        pendingEnc = getSetting('admin_totp_pending_secret', '');
      } else {
        const row = await get('SELECT totp_pending_secret FROM users WHERE email = ?', [sub]);
        pendingEnc = row?.totp_pending_secret ? String(row.totp_pending_secret) : '';
      }

      if (!pendingEnc) {
        throw new HttpError(400, 'Inicie a configuracao do 2FA antes de ativar.');
      }

      const secret = decryptSensitiveField(pendingEnc);
      if (!verifyTotpCode(secret, code)) {
        logSecurityEvent('TOTP_2FA_ENABLE_FAILED', { sub }, req);
        throw new HttpError(400, 'Codigo 2FA invalido. Confira o horario do aplicativo autenticador.');
      }

      const encryptedSecret = encryptSensitiveField(secret);
      if (sub === 'admin') {
        await setSetting('admin_totp_secret', encryptedSecret);
        await setSetting('admin_totp_enabled', '1');
        await setSetting('admin_totp_pending_secret', '');
      } else {
        await run(
          'UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_pending_secret = NULL WHERE email = ?',
          [encryptedSecret, sub]
        );
      }

      if (res && session) {
        startSession(res, {
          secure: isSecureRequest(req),
          sub: session.sub,
          shopId: Number(session.shop_id) || 1,
          role: session.role,
          ver: session.ver,
          mfa: true,
        });
      }

      logSecurityEvent('TOTP_2FA_ENABLED', { sub }, req);
      return { status: 200, body: { enabled: true, mfa_verified: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/2fa/disable',
    handler: async ({ req, res, body, session }: RouteContext) => {
      if (session?.role === 'master') {
        throw new HttpError(
          403,
          'Contas Master nao podem desativar a autenticacao em duas etapas (2FA obrigatorio).'
        );
      }
      const sub = String(session?.sub || 'admin');
      const password = requiredString(body.password ?? body.current_password, 'senha atual', { max: 128 });
      const code = requiredString(body.code, 'codigo 2FA', { max: 12 });

      if (sub === 'admin') {
        const storedHash = getSettingsMap().admin_password_hash;
        if (!verifyPassword(password, storedHash)) {
          throw new HttpError(400, 'Senha atual incorreta.');
        }
        const secretEnc = getSetting('admin_totp_secret', '');
        if (!secretEnc || !verifyTotpCode(decryptSensitiveField(secretEnc), code)) {
          throw new HttpError(400, 'Codigo 2FA invalido.');
        }
        await setSetting('admin_totp_secret', '');
        await setSetting('admin_totp_enabled', '0');
        await setSetting('admin_totp_pending_secret', '');
      } else {
        const user = await get('SELECT password_hash, totp_secret FROM users WHERE email = ?', [sub]);
        if (!user || !verifyPassword(password, user.password_hash)) {
          throw new HttpError(400, 'Senha atual incorreta.');
        }
        const secretEnc = user.totp_secret ? String(user.totp_secret) : '';
        if (!secretEnc || !verifyTotpCode(decryptSensitiveField(secretEnc), code)) {
          throw new HttpError(400, 'Codigo 2FA invalido.');
        }
        await run(
          'UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_pending_secret = NULL WHERE email = ?',
          [sub]
        );
      }

      if (res && session) {
        startSession(res, {
          secure: isSecureRequest(req),
          sub: session.sub,
          shopId: Number(session.shop_id) || 1,
          role: session.role,
          ver: session.ver,
          mfa: false,
        });
      }

      logSecurityEvent('TOTP_2FA_DISABLED', { sub }, req);
      return { status: 200, body: { enabled: false, mfa_verified: false } };
    },
  },
  {
    method: 'GET',
    path: '/api/auth/oauth/providers',
    auth: false,
    handler: () => ({
      status: 200,
      body: { google: isGoogleOAuthEnabled() },
    }),
  },
  {
    method: 'GET',
    path: '/api/auth/oauth/google',
    auth: false,
    handler: ({ req, res }: RouteContext) => {
      if (!isGoogleOAuthEnabled()) {
        throw new HttpError(503, 'Login com Google nao configurado neste servidor.');
      }
      const state = createOAuthState();
      setCookie(res, OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: isSecureRequest(req),
        maxAge: 10 * 60 * 1000,
      });
      const url = buildGoogleAuthUrl(req, state);
      res.writeHead(302, { Location: url });
      res.end();
      return null;
    },
  },
  {
    method: 'GET',
    path: '/api/auth/oauth/google/callback',
    auth: false,
    handler: async ({ req, res, query }: RouteContext) => {
      const secure = isSecureRequest(req);
      const cookies = parseCookies(req);
      const expectedState = cookies[OAUTH_STATE_COOKIE];
      clearCookie(res, OAUTH_STATE_COOKIE, { secure });

      if (query?.error) {
        return redirectWithOAuthError(req, res, 'Autenticacao cancelada ou recusada pelo Google.', 403);
      }

      const receivedState = query?.state;
      if (!verifyOAuthState(expectedState, receivedState)) {
        return redirectWithOAuthError(req, res, 'Sessao OAuth invalida ou expirada. Tente novamente.', 403);
      }

      const code = query?.code;
      if (!code) {
        return redirectWithOAuthError(req, res, 'Codigo de autorizacao ausente.', 400);
      }

      try {
        const profile = await fetchGoogleUserInfo(req, code);
        const authResult = await authorizeGoogleUser(profile);
        if (!authResult.allowed) {
          return redirectWithOAuthError(
            req,
            res,
            authResult.reason ?? 'Acesso nao autorizado.',
            authResult.status || 403
          );
        }

        const userRow = await get('SELECT session_version FROM users WHERE email = ?', [
          authResult.user.email,
        ]);
        startSession(res, {
          secure,
          sub: authResult.user.email,
          shopId: authResult.user.shop_id,
          role: authResult.user.role,
          ver: Number(userRow?.session_version ?? 1) || 1,
        });
        res.writeHead(302, { Location: '/#dashboard' });
        res.end();
        return null;
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : 'Falha ao autenticar com Google.';
        const errStatus = err instanceof HttpError ? err.status : 401;
        return redirectWithOAuthError(req, res, errMessage || 'Falha ao autenticar com Google.', errStatus);
      }
    },
  },
  {
    method: 'GET',
    path: '/api/auth/demo-session',
    auth: false,
    handler: ({ req, res, query }: RouteContext) => {
      if (!isDemoMode() || process.env.NODE_ENV === 'production') {
        throw new HttpError(403, 'Apenas em modo demonstracao.');
      }
      startSession(res, {
        secure: isSecureRequest(req),
        sub: 'demo@novaruntime.local',
        shopId: 1,
        role: 'owner',
      });
      const view = query.view || 'dashboard';
      res.writeHead(302, { Location: `/#${view}` });
      res.end();
      return null;
    },
  },
  {
    method: 'GET',
    path: '/api/billing/plan',
    handler: async ({ shopId = 1 }: RouteContext) => {
      const [current, plans, barbersRow] = await Promise.all([
        getShopPlan(shopId),
        listPlans(),
        get('SELECT COUNT(*) AS total FROM barbers WHERE shop_id = ? AND active = 1', [shopId]),
      ]);
      return {
        status: 200,
        body: {
          plan: current,
          usage: { active_barbers: Number(barbersRow?.total || 0) },
          available_plans: plans,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/billing/upgrade',
    handler: async ({ body, session, shopId = 1 }: RouteContext) => {
      if (process.env.NODE_ENV === 'production' && session?.role !== 'master') {
        throw new HttpError(403, 'Alteracao de plano requer confirmacao de pagamento ou permissao master.');
      }
      const planId = requiredString(body.plan_id, 'plano', { max: 40 });
      const updated = await setShopPlan(shopId, planId, { provider: 'manual' });
      return { status: 200, body: { upgraded: true, plan: updated } };
    },
  },
];
