import {
  endSession,
  isAuthenticated,
  isUsingDefaultPassword,
  startSession,
  verifyPassword,
} from '../auth.js';
import { getSetting } from '../db.js';
import { isDemoMode } from '../demo.js';
import { HttpError } from '../http.js';
import { clientIp, isSecureRequest, loginLimiter } from '../security.js';
import { requiredString } from '../validate.js';

function statusPayload(req, authenticated) {
  return {
    authenticated,
    shop_name: getSetting('shop_name', 'Gestor de Barbearia'),
    company: getSetting('shop_company', 'Nova Runtime'),
    password_is_default: isUsingDefaultPassword(),
    demo: isDemoMode(),
  };
}

export const authRoutes = [
  {
    method: 'POST',
    path: '/api/auth/login',
    auth: false,
    handler: ({ req, res, body }) => {
      const ip = clientIp(req);
      const key = `login:${ip}`;
      const limit = loginLimiter.check(key);

      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        throw new HttpError(429, limit.message);
      }

      const password = requiredString(body.password, 'senha', { max: 128 });
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
    path: '/api/auth/logout',
    auth: false,
    handler: ({ req, res }) => {
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
];
