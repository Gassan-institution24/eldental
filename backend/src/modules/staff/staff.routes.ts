import { Router } from 'express';
import { asyncHandler } from '@/core/http/asyncHandler';
import { created, ok } from '@/core/http/response';
import { exportRateLimit } from '@/core/http/security';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import type { Override } from '@/core/rbac/rbac.types';
import { body, params, query, validate } from '@/core/validation/validate';
import * as s from './staff.schemas';
import * as svc from './staff.service';

export const staffRouter = Router();

staffRouter.get('/staff/me', authorize.self('staff'), asyncHandler(async (req, res) => ok(res, await svc.myStaff(req.auth!))));

staffRouter.get(
  '/staff',
  authorize('staff.member.read'),
  validate({ query: s.staffListQuery }),
  asyncHandler(async (req, res) => {
    const r = await svc.listStaff(req.auth!, query(req, s.staffListQuery));
    ok(res, r.data, r.meta);
  }),
);

staffRouter.get(
  '/staff/export',
  authorize('staff.member.export'),
  exportRateLimit,
  validate({ query: s.staffListQuery }),
  asyncHandler(async (req, res) => {
    const { exportStaffCsv } = await import('./staff.export');
    const csv = await exportStaffCsv(req.auth!, query(req, s.staffListQuery));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="staff.csv"');
    res.send(csv);
  }),
);

/** The clinic's specialties, derived from its active dentists and hygienists (no separate catalog, 07 §13). */
staffRouter.get('/staff/specialties', authorize('staff.member.read', 'scheduling.schedule.read', 'scheduling.appointment.book'), asyncHandler(async (_req, res) => ok(res, await svc.clinicSpecialties())));

staffRouter.get('/staff/:id', authorize('staff.member.read'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.getStaff(req.auth!, params(req, s.idParams).id))));

staffRouter.post(
  '/staff',
  authorize('staff.member.create'),
  validate({ body: s.staffInviteBody }),
  asyncHandler(async (req, res) => {
    const staff = await svc.inviteStaff(req.auth!, body(req, s.staffInviteBody));
    created(res, staff, `/staff/${staff.id}`);
  }),
);

staffRouter.patch(
  '/staff/:id',
  authorize('staff.member.update'),
  validate({ params: s.idParams, body: s.staffUpdateBody }),
  asyncHandler(async (req, res) => ok(res, await svc.updateStaff(req.auth!, params(req, s.idParams).id, body(req, s.staffUpdateBody)))),
);

staffRouter.post('/staff/:id/resend-invite', authorize('staff.member.create'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.resendInvite(req.auth!, params(req, s.idParams).id))));

staffRouter.post(
  '/staff/:id/deactivate',
  authorize('staff.member.delete'),
  validate({ params: s.idParams, body: s.deactivateBody }),
  asyncHandler(async (req, res) => ok(res, await svc.deactivateStaff(req.auth!, params(req, s.idParams).id, body(req, s.deactivateBody)))),
);

staffRouter.post('/staff/:id/reactivate', authorize('staff.member.delete'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.reactivateStaff(req.auth!, params(req, s.idParams).id))));

// HR (staff.member.update) changes job roles too; the access boundary limits what anyone may grant (04 §9.2).
staffRouter.put(
  '/staff/:id/roles',
  authorize('staff.role.manage', 'staff.member.update'),
  validate({ params: s.idParams, body: s.staffRolesBody }),
  asyncHandler(async (req, res) => ok(res, await svc.setStaffRoles(req.auth!, params(req, s.idParams).id, body(req, s.staffRolesBody)))),
);

// The service also requires the caller to be the clinic owner; the permission alone is not enough.
staffRouter.post(
  '/staff/:id/transfer-ownership',
  authorize('staff.role.manage'),
  validate({ params: s.idParams, body: s.transferOwnershipBody }),
  asyncHandler(async (req, res) => ok(res, await svc.transferOwnership(req.auth!, params(req, s.idParams).id, body(req, s.transferOwnershipBody).password))),
);

staffRouter.get('/staff/:id/permission-overrides', authorize('staff.role.manage'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.getOverrides(params(req, s.idParams).id))));

staffRouter.put(
  '/staff/:id/permission-overrides',
  authorize('staff.role.manage'),
  validate({ params: s.idParams, body: s.overridesBody }),
  asyncHandler(async (req, res) => ok(res, await svc.setOverrides(req.auth!, params(req, s.idParams).id, body(req, s.overridesBody).overrides as Override[]))),
);

staffRouter.get('/staff/:id/effective-permissions', authorize('staff.role.manage'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.effectivePermissions(req.auth!, params(req, s.idParams).id))));

registerPath({ method: 'get', path: '/staff', tags: ['staff'], summary: 'List staff (fields filtered by field rules)', query: s.staffListQuery });
registerPath({ method: 'get', path: '/staff/specialties', tags: ['staff'], summary: 'Specialties offered by the clinic (derived from its doctors)' });
registerPath({ method: 'get', path: '/staff/:id', tags: ['staff'], summary: 'Get staff member', params: s.idParams });
registerPath({ method: 'post', path: '/staff', tags: ['staff'], summary: 'Invite staff', body: s.staffInviteBody });
registerPath({ method: 'patch', path: '/staff/:id', tags: ['staff'], summary: 'Update staff (403 FIELD_FORBIDDEN on non-writable fields)', params: s.idParams, body: s.staffUpdateBody });
registerPath({ method: 'put', path: '/staff/:id/roles', tags: ['staff'], summary: 'Assign roles', params: s.idParams, body: s.staffRolesBody });
registerPath({ method: 'post', path: '/staff/:id/transfer-ownership', tags: ['staff'], summary: 'Transfer clinic ownership (current owner only, password required)', params: s.idParams, body: s.transferOwnershipBody });
registerPath({ method: 'put', path: '/staff/:id/permission-overrides', tags: ['staff'], summary: 'Per-staff overrides', params: s.idParams, body: s.overridesBody });
