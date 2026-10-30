import type { ClientSession, Types } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import { withTransaction } from '@/core/db/transaction';
import { nextNumber } from '@/core/db/sequence';
import { ApiError } from '@/core/http/ApiError';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { hashPassword, sendInvitation } from '@/modules/auth/auth.service';
import { seedClinicRoles } from '@/modules/roles/roles.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { UserModel, type UserDoc } from '@/modules/users/user.model';
import { toSearchName } from '@/shared/validation/normalize';
import { ClinicModel, type ClinicDoc } from './clinic.model';

/**
 * Seeders other modules register (chart of accounts, fiscal year, tax rates, leave types,
 * salary components, appointment types…). They run inside the creation transaction.
 */
type ClinicSeeder = { name: string; run: (clinic: ClinicDoc, session: ClientSession) => Promise<void> };
const seeders: ClinicSeeder[] = [];
export function registerClinicSeeder(s: ClinicSeeder): void {
  if (!seeders.some((x) => x.name === s.name)) seeders.push(s);
}

export type CreateClinicInput = {
  name: string;
  slug: string;
  timezone?: string;
  currency?: string;
  locale?: 'ar' | 'en';
  planId?: string;
  trialDays?: number;
  owner: { name: string; email?: string; phone?: string; password?: string };
  sendInvite?: boolean;
};

/**
 * Clinic onboarding (13 Phase 2): creates the clinic, then seeds roles and every registered
 * seeder, creates the owner staff, and invites the owner — all in one transaction.
 */
export async function createClinic(input: CreateClinicInput): Promise<{ clinic: ClinicDoc; owner: UserDoc; inviteToken?: string }> {
  const taken = await runWithoutTenant(() => ClinicModel.exists({ slug: input.slug }));
  if (taken) throw ApiError.validation([{ path: 'slug', code: 'slug_taken' }]);

  const result = await withTransaction(async (session) => {
    const [clinic] = await runWithoutTenant(() =>
      ClinicModel.create(
        [
          {
            name: input.name,
            searchName: toSearchName(input.name),
            slug: input.slug,
            timezone: input.timezone ?? 'Asia/Amman',
            currency: input.currency ?? 'JOD',
            locale: input.locale ?? 'ar',
            planId: input.planId,
            subscription: { status: 'trialing', trialEndsAt: new Date(Date.now() + (input.trialDays ?? 30) * 86_400_000) },
          },
        ],
        { session },
      ),
    );
    if (!clinic) throw new Error('clinic not created');
    return runInTenant(clinic._id, async () => {
      const roles = await seedClinicRoles(session);
      for (const s of seeders) await s.run(clinic, session);

      let owner = await UserModel.findOne(input.owner.email ? { email: input.owner.email } : { 'phone.e164': input.owner.phone }).session(session);
      if (owner && owner.kind !== 'staff') throw ApiError.conflict('DUPLICATE', 'Owner email belongs to another account type', { fields: ['owner.email'] });
      if (!owner) {
        owner = new UserModel({
          kind: 'staff',
          email: input.owner.email,
          ...(input.owner.phone ? { phone: { e164: input.owner.phone } } : {}),
          displayName: input.owner.name,
          locale: input.locale ?? 'ar',
          ...(input.owner.password ? { passwordHash: await hashPassword(input.owner.password), emailVerifiedAt: new Date() } : {}),
        });
        await owner.save({ session });
      }
      const ownerRole = roles.find((r) => r.key === 'owner');
      await StaffModel.create(
        [
          {
            userId: owner._id,
            fileNumber: await nextNumber('staff', 'STF', { pad: 4, session, clinicId: clinic._id }),
            name: input.owner.name,
            searchName: toSearchName(input.owner.name),
            email: input.owner.email,
            ...(input.owner.phone ? { phone: { e164: input.owner.phone } } : {}),
            staffType: 'manager',
            jobTitle: '',
            isOwner: true,
            roleIds: ownerRole ? [ownerRole._id] : [],
          },
        ],
        { session },
      );
      clinic.ownerUserId = owner._id as Types.ObjectId;
      await clinic.save({ session });
      return { clinic, owner };
    });
  });
  await recordAudit({ action: 'create', entity: 'clinic', entityId: result.clinic._id, clinicId: result.clinic._id, after: { name: input.name, slug: input.slug } });
  let inviteToken: string | undefined;
  if (input.sendInvite !== false && !input.owner.password) {
    inviteToken = await sendInvitation(result.owner, { id: String(result.clinic._id), name: result.clinic.name });
  }
  return { ...result, ...(inviteToken ? { inviteToken } : {}) };
}
