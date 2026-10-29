import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '@/app';
import { ApiError } from '@/core/http/ApiError';
import { asyncHandler } from '@/core/http/asyncHandler';
import { errorHandler } from '@/core/http/errorHandler';
import { requestId } from '@/core/http/requestId';
import { SystemErrorModel } from '@/core/logging/systemError.model';
import { validate } from '@/core/validation/validate';
import { personName } from '@/shared/validation/fields';
import { useTestDb } from './db';

useTestDb();

function miniApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.post(
    '/v',
    validate({ body: z.object({ firstName: personName(), age: z.number().int().min(0) }) }),
    (req, res) => res.json({ data: req.valid.body }),
  );
  app.get('/forbidden', () => {
    throw ApiError.forbidden('FORBIDDEN', 'nope', { permission: 'x.y.z' });
  });
  app.get(
    '/boom',
    asyncHandler(async () => {
      throw new Error('kaboom');
    }),
  );
  app.use(errorHandler);
  return app;
}

describe('system endpoints', () => {
  it('GET /health → 200', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /ready reports mongo', async () => {
    const res = await request(createApp()).get('/ready');
    expect(res.body.data.mongo).toBe(true);
  });

  it('unknown route → 404 envelope', async () => {
    const res = await request(createApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('sets security headers (helmet)', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects disallowed CORS origins', async () => {
    const res = await request(createApp()).get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await request(createApp()).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('requires X-Requested-With for browser mutations', async () => {
    const res = await request(createApp())
      .post('/api/v1/anything')
      .set('Origin', 'http://localhost:5173')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
  });
});

describe('error handling', () => {
  it('validation → 422 with path + code', async () => {
    const res = await request(miniApp()).post('/v').send({ firstName: 'A', age: -1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'firstName', code: 'too_short' }),
        expect.objectContaining({ path: 'age', code: 'too_small' }),
      ]),
    );
  });

  it('missing field → required', async () => {
    const res = await request(miniApp()).post('/v').send({ age: 3 });
    expect(res.body.error.details.fields[0]).toMatchObject({ path: 'firstName', code: 'required' });
  });

  it('ApiError → its status and code', async () => {
    const res = await request(miniApp()).get('/forbidden');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'x.y.z' } });
  });

  it('a 500 creates and then increments one systemErrors row (same fingerprint)', async () => {
    const app = miniApp();
    const r1 = await request(app).get('/boom');
    expect(r1.status).toBe(500);
    expect(r1.body.error.code).toBe('INTERNAL_ERROR');
    await request(app).get('/boom');
    await new Promise((r) => setTimeout(r, 200));
    const rows = await SystemErrorModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences).toBe(2);
    expect(rows[0]?.message).toBe('kaboom');
  });
});
