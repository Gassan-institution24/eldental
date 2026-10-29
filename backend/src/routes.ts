import { Router } from 'express';
import { authRateLimit } from '@/core/http/security';
import { moduleRouters } from './modules';

/** Mounts every module router under API_PREFIX. Modules list themselves in `modules/index.ts`. */
export function buildApiRouter(): Router {
  const api = Router();
  api.use('/auth', authRateLimit);
  for (const r of moduleRouters) api.use(r);
  return api;
}
