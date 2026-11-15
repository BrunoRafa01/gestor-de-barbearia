import {
  endSession,
  hashPassword,
  isAuthenticated,
  isUsingDefaultPassword,
  passwordIssue,
  revokeAllSessions,
  startSession,
  verifyPassword,
} from '../auth.js';
import { get, getSetting, run } from '../db.js';
import { getShopPlan, listPlans, setShopPlan } from '../plans.js';
import { isDemoMode } from '../demo.js';
import { HttpError } from '../http.js';
import { clientIp, isSecureRequest, loginLimiter } from '../security.js';
import { optionalEmail, requiredString } from '../validate.js';

function statusPayload(req, authenticated) {
  const payload = {
    authenticated,
    shop_name: getSetting('shop_name', 'Gestor de Barbearia'),
    company: getSetting('shop_company', 'Nova Runtime'),
    demo: isDemoMode(),
  };
  if (authenticated) {
    payload.password_is_default = isUsingDefaultPassword();
  }
  return payload;
}

export const authRoutes = [
  {
    method: 'POST',
    path: '/api/auth/login',
    auth: false,
    handler: async ({ req, res, body }) => {
      const ip = clientIp(req);
      const key = `login:${ip}`;
      const limit = loginLimiter.check(key);

      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        throw new HttpError(429, limit.message);
      }

      const password = requiredString(body.password, 'senha', { max: 128 });
      const email = optionalEmail(body.email);

      if (email) {
        const user = await get('SELECT * FROM users WHERE email = ? AND active = 1', [email]);
        if (!user || !verifyPassword(password, user.password_hash)) {
          throw new HttpError(401, 'E-mail ou senha incorretos.');
        }
        loginLimiter.reset(key);
        startSession(res, {
          secure: isSecureRequest(req),
          sub: user.email,
          shopId: user.shop_id,
          role: user.role,
        });
        return {
          status: 200,
          body: { ...statusPayload(req, true), shop_id: user.shop_id, role: user.role, user: user.email },
        };
      }

      const stored = getSetting('admin_password_hash');

      if (!verifyPassword(password, stored)) {
        throw new HttpError(401, 'Senha incorreta.');
      }

      loginLimiter.reset(key);
      startSession(res, { secure: isSecureRequest(req) });
      return { status: 200, body: statusPayload(req, true) };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/register-shop',
    auth: false,
    handler: async ({ req, res, body }) => {
      const ip = clientIp(req);
      const limit = loginLimiter.check(`register:${ip}`);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        throw new HttpError(429, limit.message);
      }

      const shopName = requiredString(body.shop_name, 'nome da barbearia', { max: 120 });
      const ownerName = requiredString(body.name, 'seu nome', { max: 120 });
      const email = optionalEmail(body.email);
      if (!email) throw new HttpError(400, 'Informe um e-mail valido.');
      const password = requiredString(body.password, 'senha', { max: 128 });
      const issue = passwordIssue(password);
      if (issue) throw new HttpError(400, issue);

      const baseSlug = shopName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'barbearia';
      const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

      const existingUser = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (existingUser) throw new HttpError(409, 'Ja existe uma conta cadastrada com este e-mail.');

      const shopInfo = await run(
        'INSERT INTO barbershops (slug, name, company, active) VALUES (?, ?, ?, 1)',
        [slug, shopName, shopName]
      );
      const shopId = Number(shopInfo.lastInsertRowid);
      await run(
        'INSERT INTO users (shop_id, email, name, password_hash, role, active) VALUES (?, ?, ?, ?, ?, 1)',
        [shopId, email, ownerName, hashPassword(password), 'owner']
      );
      await setShopPlan(shopId, 'free', { provider: 'onboarding' });

      startSession(res, {
        secure: isSecureRequest(req),
        sub: email,
        shopId,
        role: 'owner',
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
    handler: async ({ req, res }) => {
      if (isAuthenticated(req)) {
        await revokeAllSessions();
      }
      endSession(res, { secure: isSecureRequest(req) });
      return { status: 200, body: { authenticated: false } };
    },
  },
  {
    method: 'GET',
    path: '/api/auth/me',
    auth: false,
    handler: ({ req }) => ({
      status: 200,
      body: statusPayload(req, isAuthenticated(req)),
    }),
  },
  {
    method: 'GET',
    path: '/api/auth/demo-session',
    auth: false,
    handler: ({ req, res, query }) => {
      if (!isDemoMode() || process.env.NODE_ENV === 'production') {
        throw new HttpError(403, 'Apenas em modo demonstracao.');
      }
      startSession(res, { secure: isSecureRequest(req) });
      const view = query.view || 'dashboard';
      res.writeHead(302, { Location: `/#${view}` });
      res.end();
    },
  },
  {
    method: 'GET',
    path: '/api/billing/plan',
    handler: async ({ shopId = 1 }) => {
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
    handler: async ({ body, shopId = 1 }) => {
      const planId = requiredString(body.plan_id, 'plano', { max: 40 });
      const updated = await setShopPlan(shopId, planId, { provider: 'manual' });
      return { status: 200, body: { upgraded: true, plan: updated } };
    },
  },
];
