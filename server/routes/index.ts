import type { RouteDefinition } from '../types.js';
import { appointmentRoutes } from './appointments.routes.js';
import { authRoutes } from './auth.routes.js';
import { backupRoutes } from './backup.routes.js';
import { barberRoutes } from './barbers.routes.js';
import { clientRoutes } from './clients.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import { financeRoutes } from './finance.routes.js';
import { healthRoutes } from './health.routes.js';
import { lgpdRoutes } from './lgpd.routes.js';
import { masterRoutes } from './master.routes.js';
import { publicRoutes } from './public.routes.js';
import { reportRoutes } from './reports.routes.js';
import { serviceRoutes } from './services.routes.js';
import { settingsRoutes } from './settings.routes.js';
import { whatsappRoutes } from './whatsapp.routes.js';

/**
 * Todas as rotas da API. Por padrao exigem sessao de administrador;
 * rotas publicas declaram explicitamente `auth: false`.
 */
export const apiRoutes: RouteDefinition[] = [
  ...healthRoutes,
  ...authRoutes,
  ...publicRoutes,
  ...dashboardRoutes,
  ...reportRoutes,
  ...financeRoutes,
  ...masterRoutes,
  ...clientRoutes,
  ...barberRoutes,
  ...serviceRoutes,
  ...appointmentRoutes,
  ...settingsRoutes,
  ...whatsappRoutes,
  ...backupRoutes,
  ...lgpdRoutes,
];
