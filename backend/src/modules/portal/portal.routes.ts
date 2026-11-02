import { Router } from 'express';
import { asyncHandler } from '@/core/http/asyncHandler';
import { created, ok } from '@/core/http/response';
import { publicRoute } from '@/core/http/routeMeta';
import { publicBookingRateLimit } from '@/core/http/security';
import { registerPath } from '@/core/openapi/registry';
import { requirePatient } from '@/core/rbac/authorize';
import { body, params, query, validate } from '@/core/validation/validate';
import * as s from './portal.schemas';
import * as svc from './portal.service';

/** Patient portal (01 §4.10). Patient tokens only, limited to the account's own files (04 §6.4). */
export const portalRouter = Router();
const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const lang = (req: { headers: Record<string, unknown> }): 'ar' | 'en' => (String(req.headers['accept-language'] ?? '').startsWith('en') ? 'en' : 'ar');

/* ---------- public: clinic pages and online availability ---------- */

portalRouter.get('/portal/clinics', publicRoute(), asyncHandler(async (_req, res) => ok(res, await svc.onlineClinics())));

portalRouter.get('/portal/clinics/:slug', publicRoute(), validate({ params: s.slugParams }), asyncHandler(async (req, res) => ok(res, await svc.clinicPage(params(req, s.slugParams).slug))));

portalRouter.get(
  '/portal/clinics/:slug/availability',
  publicRoute(),
  publicBookingRateLimit,
  validate({ params: s.slugParams, query: s.availabilityQuery }),
  asyncHandler(async (req, res) => ok(res, await svc.onlineAvailability(params(req, s.slugParams).slug, query(req, s.availabilityQuery)))),
);

/* ---------- the signed-in patient ---------- */

portalRouter.get('/portal/me', requirePatient(), asyncHandler(async (req, res) => ok(res, await svc.me(uid(req)))));

portalRouter.patch('/portal/me', requirePatient(), validate({ body: s.meUpdateBody }), asyncHandler(async (req, res) => ok(res, await svc.updateMe(uid(req), body(req, s.meUpdateBody)))));

portalRouter.post(
  '/portal/link-patient/start',
  requirePatient(),
  publicBookingRateLimit,
  validate({ body: s.linkStartBody }),
  asyncHandler(async (req, res) => ok(res, await svc.linkStart(uid(req), body(req, s.linkStartBody), lang(req)))),
);

portalRouter.post(
  '/portal/link-patient',
  requirePatient(),
  publicBookingRateLimit,
  validate({ body: s.linkConfirmBody }),
  asyncHandler(async (req, res) => ok(res, await svc.linkConfirm(uid(req), body(req, s.linkConfirmBody)))),
);

portalRouter.post('/portal/dependants', requirePatient(), validate({ body: s.dependantBody }), asyncHandler(async (req, res) => created(res, await svc.addDependant(uid(req), body(req, s.dependantBody)))));

/* ---------- appointments ---------- */

portalRouter.get('/portal/appointments', requirePatient(), asyncHandler(async (req, res) => ok(res, await svc.appointments(uid(req)))));

portalRouter.post(
  '/portal/appointments',
  requirePatient(),
  publicBookingRateLimit,
  validate({ body: s.bookBody }),
  asyncHandler(async (req, res) => created(res, await svc.book(uid(req), body(req, s.bookBody)))),
);

portalRouter.post(
  '/portal/appointments/:id/cancel',
  requirePatient(),
  validate({ params: s.idParams, body: s.cancelBody }),
  asyncHandler(async (req, res) => ok(res, await svc.cancel(uid(req), params(req, s.idParams).id, body(req, s.cancelBody).comment))),
);

/* ---------- treatment plans ---------- */

portalRouter.get('/portal/treatment-plans', requirePatient(), asyncHandler(async (req, res) => ok(res, await svc.plans(uid(req)))));

portalRouter.post(
  '/portal/treatment-plans/:id/accept',
  requirePatient(),
  validate({ params: s.idParams, body: s.acceptBody }),
  asyncHandler(async (req, res) => ok(res, await svc.acceptPlan(uid(req), params(req, s.idParams).id, body(req, s.acceptBody), req.ip))),
);

/* ---------- invoices and payments ---------- */

portalRouter.get('/portal/billing', requirePatient(), asyncHandler(async (req, res) => ok(res, await svc.billing(uid(req)))));

portalRouter.get('/portal/invoices/:id/print', requirePatient(), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.invoicePrint(uid(req), params(req, s.idParams).id))));

portalRouter.get('/portal/payments/:id/receipt', requirePatient(), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.receipt(uid(req), params(req, s.idParams).id))));

registerPath({ method: 'get', path: '/portal/clinics', tags: ['patient portal'], summary: 'Clinics that take online bookings', isPublic: true });
registerPath({ method: 'get', path: '/portal/clinics/:slug', tags: ['patient portal'], summary: 'Clinic page: online appointment types, dentists and rules', params: s.slugParams, isPublic: true });
registerPath({ method: 'get', path: '/portal/clinics/:slug/availability', tags: ['patient portal'], summary: 'Online free slots (06 §2 step 7)', params: s.slugParams, query: s.availabilityQuery.innerType(), isPublic: true });
registerPath({ method: 'get', path: '/portal/me', tags: ['patient portal'], summary: 'Signed-in patient, linked files and dependants' });
registerPath({ method: 'post', path: '/portal/link-patient/start', tags: ['patient portal'], summary: 'Send a code to the phone on a clinic file', body: s.linkStartBody });
registerPath({ method: 'post', path: '/portal/link-patient', tags: ['patient portal'], summary: 'Link a clinic file with the code', body: s.linkConfirmBody });
registerPath({ method: 'post', path: '/portal/dependants', tags: ['patient portal'], summary: 'Add a child or dependant at a linked clinic', body: s.dependantBody });
registerPath({ method: 'post', path: '/portal/appointments', tags: ['patient portal'], summary: 'Book online', body: s.bookBody });
registerPath({ method: 'post', path: '/portal/appointments/:id/cancel', tags: ['patient portal'], summary: 'Cancel before the clinic window', params: s.idParams, body: s.cancelBody });
registerPath({ method: 'post', path: '/portal/treatment-plans/:id/accept', tags: ['patient portal'], summary: 'Accept a presented plan with a signature', params: s.idParams, body: s.acceptBody });
registerPath({ method: 'get', path: '/portal/billing', tags: ['patient portal'], summary: 'Invoices, payments and balances' });
