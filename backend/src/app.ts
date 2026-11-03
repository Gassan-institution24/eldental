import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import swaggerUi from 'swagger-ui-express';
import { env, isProd } from '@/config/env';
import { errorHandler, notFound } from '@/core/http/errorHandler';
import { requestId } from '@/core/http/requestId';
import { frontendRouter } from '@/core/http/spa';
import {
  corsMiddleware,
  globalRateLimit,
  helmetMiddleware,
  requireXhrHeader,
} from '@/core/http/security';
import { requestLogger } from '@/core/logging/requestLogger';
import { buildOpenApiDocument } from '@/core/openapi/registry';
import { systemRouter } from '@/modules/system/system.routes';
import { buildApiRouter } from './routes';
import '@/jobs';
import '@/modules/seeders';

/** Express app factory (02_ARCHITECTURE.md §4). Used by the server and by API tests. */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(requestId);
  // The built frontend, when this process also hosts it (one origin, no custom domain).
  const frontend = frontendRouter();
  if (frontend) app.use(frontend);
  app.use(requestLogger);
  app.use(globalRateLimit);
  // Telemetry may carry a user-confirmed screenshot; everything else is capped at 1 MB (11 §4).
  app.use(`${env.API_PREFIX}/telemetry`, express.json({ limit: '2mb' }));
  // A bulk patient import carries up to 2000 rows.
  app.use(`${env.API_PREFIX}/patients/import`, express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '1mb' }));
  // sendBeacon posts text/plain; telemetry parses it as JSON.
  app.use(`${env.API_PREFIX}/telemetry`, express.text({ type: 'text/plain', limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize({ replaceWith: '_' }));
  app.use(hpp());
  app.use(requireXhrHeader);

  app.use(systemRouter);

  if (!isProd || env.ENABLE_API_DOCS) {
    const doc = buildOpenApiDocument();
    app.get('/api/docs/openapi.json', (_req, res) => res.json(doc));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(doc));
  }

  app.use(env.API_PREFIX, buildApiRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
