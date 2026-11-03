import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { spaRouter } from '@/core/http/spa';

/** Single-origin hosting: the API process serves the built frontend (02 §4, 11 §4). */
const dist = mkdtempSync(join(tmpdir(), 'eld-dist-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.info(1)');
writeFileSync(join(dist, 'favicon.svg'), '<svg/>');

const app = express();
app.use(spaRouter(dist));
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));

afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe('spa hosting', () => {
  it('serves fingerprinted assets as immutable and other files as no-cache', async () => {
    const a = await request(app).get('/assets/app-abc123.js');
    expect(a.status).toBe(200);
    expect(a.headers['cache-control']).toContain('immutable');
    const f = await request(app).get('/favicon.svg');
    expect(f.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for app routes with a same-origin page CSP', async () => {
    const r = await request(app).get('/clinic/patients/123').set('Accept', 'text/html');
    expect(r.status).toBe(200);
    expect(r.text).toContain('id="root"');
    expect(r.headers['cache-control']).toBe('no-cache');
    const csp = r.headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('never answers API, socket or health paths with the page', async () => {
    for (const path of ['/api/v1/nope', '/api/docs', '/socket.io/', '/health', '/ready']) {
      const r = await request(app).get(path).set('Accept', 'text/html');
      expect(r.status, path).toBe(404);
      expect(r.headers['content-security-policy'], path).toBeUndefined();
    }
  });

  it('does not serve the page to non-HTML requests', async () => {
    const r = await request(app).get('/missing.js').set('Accept', 'application/javascript');
    expect(r.status).toBe(404);
  });
});
