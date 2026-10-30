import type { RequestHandler } from 'express';
import { env } from '@/config/env';
import { ClinicModel, isClinicReadOnly } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { UserModel } from '@/modules/users/user.model';
import { requestContext } from '../context/requestContext';
import { ApiError } from '../http/ApiError';
import { getPermVersion, loadStaffGrants, platformGrants } from '../rbac/permission.service';
import { runWithoutTenant } from '../tenancy/tenantPlugin';
import type { AuthContext } from './auth.types';
import { verifyAccessToken } from './token.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Paths that stay usable when the clinic is read-only (sign out, telemetry, viewing). */
const READ_ONLY_ALLOWED = [/^\/auth\//, /^\/telemetry\//, /^\/notifications/];

/** Short cache so a burst of requests does not reload the user every time. */
const userCache = new Map<string, { at: number; user: CachedUser }>();
type CachedUser = { status: string; passwordChangedAt?: number; isRoot: boolean; kind: string; platformPermissions: unknown[]; displayName: string };
const USER_TTL_MS = 5000;

export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

async function loadUser(userId: string): Promise<CachedUser | null> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.user;
  const u = await UserModel.findById(userId).select('status passwordChangedAt isRootSuperadmin kind platformPermissions displayName').lean();
  if (!u) return null;
  const user: CachedUser = {
    status: u.status,
    passwordChangedAt: u.passwordChangedAt ? Math.floor(u.passwordChangedAt.getTime() / 1000) : undefined,
    isRoot: Boolean(u.isRootSuperadmin),
    kind: u.kind,
    platformPermissions: u.platformPermissions ?? [],
    displayName: u.displayName,
  };
  userCache.set(userId, { at: Date.now(), user });
  return user;
}

/** Builds `req.auth` from a verified access token (02 §4). */
export async function buildAuthContext(token: string): Promise<AuthContext> {
  const claims = verifyAccessToken(token);
  const user = await loadUser(claims.sub);
  if (!user) throw ApiError.unauthenticated('TOKEN_INVALID', 'User not found');
  if (user.status === 'disabled') throw ApiError.unauthenticated('ACCOUNT_DISABLED', 'Account disabled');
  // Tokens issued before a password change are rejected (11 §1).
  if (user.passwordChangedAt && claims.iat < user.passwordChangedAt) throw ApiError.unauthenticated('SESSION_REVOKED', 'Password changed');

  const base: AuthContext = {
    userId: claims.sub,
    kind: claims.kind,
    tokenId: claims.jti,
    isOwner: false,
    isRoot: false,
    permVersion: claims.pv ?? 0,
    readOnly: Boolean(claims.ro),
    grants: {},
    ...(claims.imp ? { impersonatorUserId: claims.imp } : {}),
  };

  if (claims.kind === 'platform') {
    return { ...base, isRoot: user.isRoot, grants: platformGrants({ isRootSuperadmin: user.isRoot, platformPermissions: user.platformPermissions as never }) };
  }

  if (claims.kind === 'patient') {
    return { ...base, ...(claims.cid ? { clinicId: claims.cid } : {}), ...(claims.pid ? { patientId: claims.pid } : {}) } as AuthContext;
  }

  if (!claims.cid || !claims.sid) {
    // Staff with several clinics, before select-clinic: only /auth routes work.
    return base;
  }
  const [staff, clinic] = await Promise.all([
    StaffModel.findOne({ _id: claims.sid, userId: claims.sub }).setOptions({ clinicId: claims.cid }).select('status isOwner').lean(),
    runWithoutTenant(() => ClinicModel.findById(claims.cid).select('status subscription').lean()),
  ]);
  if (!staff || staff.status !== 'active') throw ApiError.unauthenticated('SESSION_REVOKED', 'Staff access revoked');
  if (!clinic) throw ApiError.unauthenticated('TOKEN_INVALID', 'Clinic not found');
  const pv = await getPermVersion(claims.cid);
  const isOwner = Boolean(staff.isOwner);
  const grants = isOwner ? {} : await loadStaffGrants(claims.cid, claims.sid, pv);
  return {
    ...base,
    clinicId: claims.cid,
    staffId: claims.sid,
    isOwner,
    permVersion: pv,
    readOnly: base.readOnly || isClinicReadOnly(clinic),
    grants,
  };
}

/** `authenticate`: verifies the bearer token, fills req.auth and the tenant context. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next();
  buildAuthContext(header.slice(7).trim())
    .then((auth) => {
      req.auth = auth;
      requestContext.assign({
        userId: auth.userId,
        ...(auth.clinicId ? { clinicId: auth.clinicId } : {}),
        ...(auth.staffId ? { staffId: auth.staffId } : {}),
        ...(auth.impersonatorUserId ? { impersonatorUserId: auth.impersonatorUserId } : {}),
      });
      const relPath = req.path.startsWith(env.API_PREFIX) ? req.path.slice(env.API_PREFIX.length) : req.path;
      if (auth.readOnly && MUTATING.has(req.method) && !READ_ONLY_ALLOWED.some((r) => r.test(relPath))) {
        return next(ApiError.forbidden(auth.impersonatorUserId ? 'IMPERSONATION_READ_ONLY' : 'SUBSCRIPTION_READ_ONLY', 'Read-only session'));
      }
      next();
    })
    .catch(next);
};
