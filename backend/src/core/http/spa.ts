import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { Router, type RequestHandler } from 'express';
import helmet from 'helmet';
import { env } from '@/config/env';

/**
 * Serves the built frontend from the API process so the app and the API share one origin
 * (needed for the `SameSite=Strict` refresh cookie when there is no custom domain, 11 §4).
 * Mounted before request logging and rate limiting: static files are not API traffic.
 */

/** Paths that always belong to the API, never to the SPA fallback. */
function isApiPath(path: string): boolean {
  return [env.API_PREFIX, '/api/', '/socket.io', '/health', '/ready'].some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
}

/** The page CSP: same-origin only, no inline scripts; MUI/Emotion injects inline styles. */
const pageHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", env.API_PUBLIC_URL.replace(/^http/, 'ws')],
      workerSrc: ["'self'", 'blob:'],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      // Only behind HTTPS; on a plain-http host it would break every asset request.
      upgradeInsecureRequests: env.API_PUBLIC_URL.startsWith('https:') ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
});

export function spaRouter(distDir: string): Router {
  const dir = resolve(distDir);
  const index = join(dir, 'index.html');
  const router = Router();
  const pageOnly: RequestHandler = (req, res, next) => (isApiPath(req.path) ? next('router') : pageHelmet(req, res, next));
  router.use(pageOnly);
  router.use(
    express.static(dir, {
      index: false,
      setHeaders(res, file) {
        // Vite fingerprints everything under /assets; the rest may change between deploys.
        res.setHeader('Cache-Control', file.includes(`${join(dir, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  router.get('*', (req, res, next) => {
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return router;
}

/** The router when `FRONTEND_DIST_DIR` points at a build, otherwise null (local dev, tests). */
export function frontendRouter(): Router | null {
  if (!env.FRONTEND_DIST_DIR) return null;
  if (!existsSync(join(resolve(env.FRONTEND_DIST_DIR), 'index.html'))) return null;
  return spaRouter(env.FRONTEND_DIST_DIR);
}
