import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '@/config/env';
import { requestContext } from '@/core/context/requestContext';
import { recordAudit } from '@/core/audit/audit.service';
import { signAccessToken, type AccessClaims } from '@/core/auth/token.service';
import { ApiError } from '@/core/http/ApiError';
import { getPermVersion } from '@/core/rbac/permission.service';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import type { UserDoc } from '@/modules/users/user.model';
import { randomToken, sha256 } from '@/shared/crypto';
import { RefreshTokenModel } from './auth.models';

export type ClinicChoice = { id: string; name: string; slug: string; isOwner: boolean };

/** Active staff memberships of a user across clinics (clinic chosen at login, 02 §5). */
export async function clinicsOf(userId: Types.ObjectId | string): Promise<(ClinicChoice & { staffId: string })[]> {
  return runWithoutTenant(async () => {
    const staff = await StaffModel.find({ userId, status: 'active' }).setOptions({ skipTenant: true }).select('clinicId isOwner').lean();
    if (!staff.length) return [];
    const clinics = await ClinicModel.find({ _id: { $in: staff.map((s) => s.clinicId) } }).select('name slug status').lean();
    return staff
      .map((s) => {
        const c = clinics.find((x) => x._id.equals(s.clinicId));
        return c ? { id: String(c._id), name: c.name, slug: c.slug, isOwner: Boolean(s.isOwner), staffId: String(s._id) } : null;
      })
      .filter((x): x is ClinicChoice & { staffId: string } => Boolean(x));
  });
}

export async function accessTokenFor(user: Pick<UserDoc, '_id' | 'kind'>, ctx: { clinicId?: string; staffId?: string; isOwner?: boolean; impersonatorUserId?: string; readOnly?: boolean; patientId?: string } = {}): Promise<string> {
  const claims: AccessClaims = { sub: String(user._id), kind: user.kind };
  if (ctx.clinicId) {
    claims.cid = ctx.clinicId;
    claims.pv = await getPermVersion(ctx.clinicId);
  }
  if (ctx.staffId) claims.sid = ctx.staffId;
  if (ctx.isOwner) claims.own = true;
  if (ctx.impersonatorUserId) claims.imp = ctx.impersonatorUserId;
  if (ctx.readOnly) claims.ro = true;
  if (ctx.patientId) claims.pid = ctx.patientId;
  return signAccessToken(claims);
}

export type IssuedRefresh = { raw: string; expiresAt: Date; remember: boolean };

/** Creates a new refresh token (optionally in an existing rotation family). */
export async function createRefreshToken(userId: Types.ObjectId | string, opts: { clinicId?: string; patientId?: string; familyId?: string; remember: boolean; impersonatorUserId?: string }): Promise<IssuedRefresh> {
  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + (opts.remember ? env.JWT_REFRESH_TTL_DAYS : 1) * 86_400_000);
  const ctx = requestContext.get();
  await RefreshTokenModel.create({
    userId,
    clinicId: opts.clinicId,
    patientId: opts.patientId,
    tokenHash: sha256(raw),
    familyId: opts.familyId ?? randomUUID(),
    remember: opts.remember,
    impersonatorUserId: opts.impersonatorUserId,
    sessionId: ctx?.sessionId,
    expiresAt,
    userAgent: ctx?.userAgent,
    ip: ctx?.ip,
  });
  return { raw, expiresAt, remember: opts.remember };
}

/**
 * A token rotated this recently may still arrive from a parallel request (two tabs, a reload while
 * a refresh is in flight). Within this window it gets a sibling token instead of being treated as
 * theft, as long as the session itself is still live (11 §1).
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

type TokenDoc = InstanceType<typeof RefreshTokenModel>;

const familyOptsOf = (t: TokenDoc) => ({
  clinicId: t.clinicId ? String(t.clinicId) : undefined,
  patientId: t.patientId ? String(t.patientId) : undefined,
  familyId: t.familyId,
  remember: t.remember ?? true,
  impersonatorUserId: t.impersonatorUserId ? String(t.impersonatorUserId) : undefined,
});

/** Rotated moments ago by a parallel request, and the session not logged out since. */
async function withinGrace(t: TokenDoc): Promise<boolean> {
  if (t.revokedReason !== 'rotated' || !t.revokedAt || Date.now() - t.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) return false;
  return Boolean(await RefreshTokenModel.exists({ familyId: t.familyId, revokedAt: null, expiresAt: { $gt: new Date() } }));
}

/** Rotation with reuse detection (11 §1): presenting a rotated token revokes the whole family. */
export async function rotateRefreshToken(raw: string): Promise<{ refresh: IssuedRefresh; token: TokenDoc }> {
  const hash = sha256(raw);
  const current = await RefreshTokenModel.findOne({ tokenHash: hash });
  if (!current) throw ApiError.unauthenticated('SESSION_REVOKED', 'Unknown refresh token');
  if (current.revokedAt) {
    if (await withinGrace(current)) return { refresh: await createRefreshToken(current.userId, familyOptsOf(current)), token: current };
    await RefreshTokenModel.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'reuse_detected' } });
    await recordAudit({ action: 'logout', entity: 'session', entityId: current.familyId, summary: 'refresh_token_reuse_detected', actorUserId: current.userId, clinicId: current.clinicId ? String(current.clinicId) : null });
    throw ApiError.unauthenticated('SESSION_REVOKED', 'Refresh token reuse detected');
  }
  if (current.expiresAt.getTime() < Date.now()) throw ApiError.unauthenticated('SESSION_REVOKED', 'Refresh token expired');
  const next = await createRefreshToken(current.userId, familyOptsOf(current));
  // Conditional update so two parallel refreshes can't both rotate it.
  const res = await RefreshTokenModel.updateOne({ _id: current._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'rotated', replacedByHash: sha256(next.raw), lastUsedAt: new Date() } });
  if (res.modifiedCount === 0) {
    // Lost the race to a parallel refresh: fine if that one rotated it (same session), not after a logout.
    const latest = await RefreshTokenModel.findById(current._id);
    if (latest && (await withinGrace(latest))) return { refresh: next, token: current };
    await RefreshTokenModel.deleteOne({ tokenHash: sha256(next.raw) });
    throw ApiError.unauthenticated('SESSION_REVOKED', 'Refresh token already used');
  }
  return { refresh: next, token: current };
}

export async function revokeFamilyByRaw(raw: string | undefined): Promise<void> {
  if (!raw) return;
  const t = await RefreshTokenModel.findOne({ tokenHash: sha256(raw) }).lean();
  if (t) await RefreshTokenModel.updateMany({ familyId: t.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
}

export async function revokeAllForUser(userId: Types.ObjectId | string, exceptFamilyId?: string): Promise<void> {
  await RefreshTokenModel.updateMany(
    { userId, revokedAt: null, ...(exceptFamilyId ? { familyId: { $ne: exceptFamilyId } } : {}) },
    { $set: { revokedAt: new Date(), revokedReason: 'revoke_all' } },
  );
}

/** Sets the clinic on the current refresh family (select-clinic / switch clinic). */
export async function setFamilyClinic(raw: string | undefined, clinicId: string): Promise<void> {
  if (!raw) return;
  const t = await RefreshTokenModel.findOne({ tokenHash: sha256(raw) }).lean();
  if (t) await RefreshTokenModel.updateMany({ familyId: t.familyId, revokedAt: null }, { $set: { clinicId: new Types.ObjectId(clinicId) } });
}

export async function familyOf(raw: string | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  const t = await RefreshTokenModel.findOne({ tokenHash: sha256(raw) }).select('familyId').lean();
  return t?.familyId;
}
