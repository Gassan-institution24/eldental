import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { hashPassword } from '@/modules/auth/auth.service';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { createClinic } from '@/modules/platform/onboarding.service';
import { RoleModel } from '@/modules/roles/role.model';
import { syncRoleTemplates } from '@/modules/roles/roles.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { UserModel } from '@/modules/users/user.model';
import { toSearchName } from '@/shared/validation/normalize';

export const DEMO_PASSWORD = 'Password123!';

export const DEMO_STAFF = [
  { email: 'dentist@smile.local', name: 'د. سارة الخطيب', staffType: 'dentist', role: 'dentist', color: '#5B6CFF', specialties: ['endodontics', 'general'], primarySpecialty: 'endodontics', bookableOnline: true, salary: 1_500_000 },
  { email: 'dentist2@smile.local', name: 'Dr. Omar Haddad', staffType: 'dentist', role: 'dentist', color: '#E67E22', specialties: ['orthodontics'], primarySpecialty: 'orthodontics', bookableOnline: true, salary: 1_400_000 },
  { email: 'reception@smile.local', name: 'ليلى منصور', staffType: 'receptionist', role: 'receptionist', color: '#0288D1', salary: 550_000 },
  { email: 'accountant@smile.local', name: 'Khaled Nasser', staffType: 'accountant', role: 'accountant', color: '#2E7D32', salary: 800_000 },
  { email: 'hr@smile.local', name: 'رنا العلي', staffType: 'hr', role: 'hr_manager', color: '#8E44AD', salary: 750_000 },
] as const;

/** Root superadmin from env (04 §8.1). MFA is set up on first login. */
export async function seedRootSuperadmin(): Promise<void> {
  const email = env.SEED_SUPERADMIN_EMAIL;
  const password = env.SEED_SUPERADMIN_PASSWORD;
  if (!email || !password) {
    logger.warn('SEED_SUPERADMIN_EMAIL/PASSWORD not set — skipping root superadmin');
    return;
  }
  const existing = await UserModel.findOne({ email });
  if (existing) {
    if (!existing.isRootSuperadmin) {
      existing.isRootSuperadmin = true;
      existing.platformRole = 'superadmin';
      await existing.save();
    }
    logger.info({ email }, 'root superadmin exists');
    return;
  }
  await UserModel.create({
    kind: 'platform',
    platformRole: 'superadmin',
    isRootSuperadmin: true,
    email,
    displayName: 'Root Superadmin',
    locale: 'ar',
    passwordHash: await hashPassword(password),
    emailVerifiedAt: new Date(),
  });
  logger.info({ email }, 'root superadmin created');
}

/** Demo clinic "Smile Clinic" with an owner, dentists, reception, accountant and HR. */
export async function seedDemoClinic(): Promise<string> {
  const existing = await runWithoutTenant(() => ClinicModel.findOne({ slug: 'smile' }));
  let clinicId: string;
  if (existing) {
    clinicId = String(existing._id);
    logger.info('demo clinic exists');
  } else {
    const { clinic } = await createClinic({
      name: 'عيادة الابتسامة — Smile Clinic',
      slug: 'smile',
      owner: { name: 'د. أحمد يوسف', email: 'owner@smile.local', password: DEMO_PASSWORD },
      sendInvite: false,
    });
    clinicId = String(clinic._id);
    await ClinicModel.updateOne(
      { _id: clinic._id },
      { $set: { 'subscription.status': 'active', 'settings.onlineBookingEnabled': true, phone: { e164: '+96265000000' }, email: 'hello@smile.local', 'address.line1': 'شارع الجامعة، عمّان' } },
    );
    logger.info('demo clinic created');
  }

  await runInTenant(clinicId, async () => {
    const roles = await RoleModel.find({}).lean();
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const s of DEMO_STAFF) {
      let user = await UserModel.findOne({ email: s.email });
      if (!user) user = await UserModel.create({ kind: 'staff', email: s.email, displayName: s.name, locale: 'ar', passwordHash: hash, emailVerifiedAt: new Date() });
      const exists = await StaffModel.findOne({ userId: user._id });
      if (exists) continue;
      const role = roles.find((r) => r.key === s.role);
      const count = await StaffModel.countDocuments({});
      await StaffModel.create({
        userId: user._id,
        fileNumber: `STF-${String(count + 1).padStart(4, '0')}`,
        name: s.name,
        searchName: toSearchName(s.name),
        email: s.email,
        phone: { e164: `+96279${String(1000000 + count * 1111).slice(0, 7)}` },
        staffType: s.staffType,
        jobTitle: '',
        roleIds: role ? [role._id] : [],
        color: s.color,
        ...('specialties' in s ? { specialties: s.specialties, primarySpecialty: s.primarySpecialty } : {}),
        bookableOnline: 'bookableOnline' in s ? s.bookableOnline : false,
        licenseNumber: s.staffType === 'dentist' ? `JDA-${1000 + count}` : undefined,
        compensation: { basicSalary: s.salary, currency: 'JOD', payFrequency: 'monthly' },
        employment: { type: 'full_time', hireDate: '2024-01-01' },
      });
    }
  });
  return clinicId;
}

export async function seedCore(): Promise<string> {
  await syncRoleTemplates();
  await seedRootSuperadmin();
  return seedDemoClinic();
}
