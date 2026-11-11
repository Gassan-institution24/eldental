import { Router } from 'express';
import { authenticate } from '@/core/auth/authenticate';
import { authRateLimit } from '@/core/http/security';
import { recordApiAction } from '@/modules/telemetry/telemetry.service';
import { moduleRouters } from './modules';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Routes that take a password, a code or an invitation token get the strict auth limit (11 §4).
 * Session routes (`/auth/refresh`, `/auth/me`, logout, select-clinic) are not on it: every page
 * load and every token renewal calls them, so a few reloads or a clinic sharing one IP would hit
 * the limit and sign people out. They stay under the global limit.
 */
const CREDENTIAL_ROUTES = [
  '/auth/login',
  '/auth/password',
  '/auth/patient/register',
  '/auth/invitations',
  '/auth/verify',
  '/auth/mfa',
];

/** Mounts every module router under API_PREFIX. Modules list themselves in `modules/index.ts`. */
export function buildApiRouter(): Router {
  const api = Router();
  api.use(CREDENTIAL_ROUTES, authRateLimit);
  api.use(authenticate);
  // Backend API action summaries feed the activity stream (15 §1).
  api.use((req, res, next) => {
    res.on('finish', () => {
      if (!MUTATING.has(req.method) || res.statusCode >= 400 || !req.auth || req.path.startsWith('/telemetry')) return;
      const routePath = (req.route as { path?: string } | undefined)?.path ?? req.path;
      recordApiAction({
        userId: req.auth.userId as never,
        clinicId: req.auth.clinicId as never,
        staffId: req.auth.staffId as never,
        impersonatorUserId: req.auth.impersonatorUserId as never,
        sessionId: req.sessionId,
        reqId: req.id,
        route: routePath,
        action: `${req.method} ${routePath}`,
        meta: { status: res.statusCode, permission: req.auth.permission ?? null },
      });
    });
    next();
  });
  for (const r of moduleRouters) api.use(r);
  return api;
}
