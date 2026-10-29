import { Router } from 'express';
import { env } from '@/config/env';
import { pingDb } from '@/config/db';
import { pingRedis } from '@/config/redis';
import { asyncHandler } from '@/core/http/asyncHandler';
import { publicRoute } from '@/core/http/routeMeta';

export const systemRouter = Router();

systemRouter.get('/health', publicRoute(), (_req, res) => {
  res.json({ data: { status: 'ok', app: env.APP_NAME, version: env.APP_VERSION, time: new Date().toISOString() } });
});

systemRouter.get(
  '/ready',
  publicRoute(),
  asyncHandler(async (_req, res) => {
    const [mongo, redis] = await Promise.all([pingDb(), pingRedis()]);
    const ready = mongo && redis;
    res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ready' : 'not_ready', mongo, redis } });
  }),
);
