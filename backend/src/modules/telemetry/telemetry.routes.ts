import { Router, type Request } from 'express';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { ok } from '@/core/http/response';
import { publicRoute } from '@/core/http/routeMeta';
import { registerPath } from '@/core/openapi/registry';
import { zodErrorToFields } from '@/core/validation/zodIssues';
import { activityBody, issuesBody } from './telemetry.schemas';
import { recordActivity, recordIssues } from './telemetry.service';
import { saveScreenshotHook } from './screenshot';

export const telemetryRouter = Router();

/** sendBeacon posts text/plain; normal calls post JSON. */
function parse(req: Request): unknown {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw ApiError.badRequest('MALFORMED_JSON', 'Invalid JSON');
    }
  }
  return req.body;
}

function who(req: Request) {
  return { auth: req.auth, sessionId: req.sessionId, locale: req.header('accept-language')?.slice(0, 5) };
}

// Public so beacons work after the access token is gone; attributed by session id when anonymous.
telemetryRouter.post(
  '/telemetry/activity',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const parsed = activityBody.safeParse(parse(req));
    if (!parsed.success) throw ApiError.validation(zodErrorToFields(parsed.error));
    ok(res, { accepted: await recordActivity(parsed.data, who(req)) });
  }),
);

telemetryRouter.post(
  '/telemetry/issues',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const parsed = issuesBody.safeParse(parse(req));
    if (!parsed.success) throw ApiError.validation(zodErrorToFields(parsed.error));
    ok(res, { accepted: await recordIssues(parsed.data, who(req), saveScreenshotHook()) });
  }),
);

registerPath({ method: 'post', path: '/telemetry/activity', tags: ['telemetry'], summary: 'Batched user activity', body: activityBody, isPublic: true });
registerPath({ method: 'post', path: '/telemetry/issues', tags: ['telemetry'], summary: 'User issues and problem reports', body: issuesBody, isPublic: true });
