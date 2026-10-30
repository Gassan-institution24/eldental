import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@/core/http/asyncHandler';
import { created, noContent, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import type { Grant } from '@/core/rbac/rbac.types';
import { ROLE_TEMPLATES } from '@/core/rbac/roleTemplates';
import { body, params, validate } from '@/core/validation/validate';
import { entityName, objectId } from '@/shared/validation/fields';
import * as svc from './roles.service';

export const rolesRouter = Router();
const idParams = z.object({ id: objectId() });
const previewBody = z.object({ permissions: svc.roleBody.shape.permissions }).strict();
const cloneBody = z.object({ name: entityName({ max: 60 }) }).strict();

rolesRouter.get('/permissions', authorize('staff.role.manage', 'staff.member.read'), (_req, res) => ok(res, svc.permissionRegistry()));
rolesRouter.get('/roles', authorize('staff.role.manage', 'staff.member.read'), asyncHandler(async (_req, res) => ok(res, await svc.listRoles())));
rolesRouter.get('/roles/templates', authorize('staff.role.manage'), (_req, res) => ok(res, ROLE_TEMPLATES));
rolesRouter.get('/roles/:id', authorize('staff.role.manage'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await svc.getRole(params(req, idParams).id))));
rolesRouter.post(
  '/roles',
  authorize('staff.role.manage'),
  validate({ body: svc.roleBody }),
  asyncHandler(async (req, res) => {
    const r = await svc.createRole(req.auth!, body(req, svc.roleBody));
    created(res, r, `/roles/${r.id}`);
  }),
);
rolesRouter.patch('/roles/:id', authorize('staff.role.manage'), validate({ params: idParams, body: svc.roleUpdateBody }), asyncHandler(async (req, res) => ok(res, await svc.updateRole(req.auth!, params(req, idParams).id, body(req, svc.roleUpdateBody)))));
rolesRouter.post('/roles/:id/reset-name', authorize('staff.role.manage'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await svc.resetRoleName(params(req, idParams).id))));
rolesRouter.post('/roles/:id/clone', authorize('staff.role.manage'), validate({ params: idParams, body: cloneBody }), asyncHandler(async (req, res) => ok(res, await svc.cloneRole(req.auth!, params(req, idParams).id, body(req, cloneBody).name))));
rolesRouter.post('/roles/:id/preview-diff', authorize('staff.role.manage'), validate({ params: idParams, body: previewBody }), asyncHandler(async (req, res) => ok(res, await svc.previewDiff(params(req, idParams).id, body(req, previewBody).permissions as Grant[]))));
rolesRouter.delete(
  '/roles/:id',
  authorize('staff.role.manage'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    await svc.deleteRole(req.auth!, params(req, idParams).id);
    noContent(res);
  }),
);

registerPath({ method: 'get', path: '/permissions', tags: ['roles'], summary: 'Permission + field registry for the role editor' });
registerPath({ method: 'get', path: '/roles', tags: ['roles'], summary: 'List roles with user counts' });
registerPath({ method: 'post', path: '/roles', tags: ['roles'], summary: 'Create role', body: svc.roleBody });
registerPath({ method: 'patch', path: '/roles/:id', tags: ['roles'], summary: 'Update role', params: idParams, body: svc.roleUpdateBody });
registerPath({ method: 'post', path: '/roles/:id/preview-diff', tags: ['roles'], summary: 'Diff before saving', params: idParams, body: previewBody });
