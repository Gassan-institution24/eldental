import { z } from 'zod';

const metaValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

/** Unknown fields are stripped (15 §7); sizes are capped so telemetry can't be abused. */
export const activityEvent = z.object({
  type: z.enum(['page_view', 'action', 'search', 'filter', 'download', 'session_start', 'session_end', 'clinic_switch', 'language_switch']),
  route: z.string().max(300),
  at: z.coerce.date().optional(),
  action: z.string().max(120).optional(),
  entity: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  meta: z.record(metaValue).refine((m) => Object.keys(m).length <= 20, { message: 'too_many' }).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
});

export const activityBody = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  appVersion: z.string().max(40).optional(),
  events: z.array(activityEvent).min(1).max(100),
});

export const issueEvent = z.object({
  kind: z.enum(['js_error', 'api_error', 'validation_error', 'slow_page', 'offline', 'permission_denied', 'rage_click', 'user_report']),
  severity: z.enum(['low', 'medium', 'high']).default('low'),
  message: z.string().max(1000).default(''),
  route: z.string().max(300),
  at: z.coerce.date().optional(),
  code: z.string().max(80).optional(),
  component: z.string().max(120).optional(),
  stack: z.string().max(8000).optional(),
  api: z
    .object({ method: z.string().max(10), path: z.string().max(300), status: z.number().int(), durationMs: z.number().optional(), reqId: z.string().max(64).optional() })
    .optional(),
  validation: z.object({ form: z.string().max(80), fields: z.array(z.object({ field: z.string().max(120), rule: z.string().max(60) })).max(50) }).optional(),
  userComment: z.string().max(2000).optional(),
  screenshot: z
    .string()
    .max(1_500_000)
    .regex(/^data:image\/(jpeg|png);base64,/)
    .optional(),
  context: z
    .object({
      recentActivity: z.array(activityEvent.partial()).max(20).optional(),
      failedReqIds: z.array(z.string().max(64)).max(20).optional(),
    })
    .optional(),
});

export const issuesBody = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  appVersion: z.string().max(40).optional(),
  issues: z.array(issueEvent).min(1).max(50),
});
