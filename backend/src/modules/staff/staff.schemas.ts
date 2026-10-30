import { z } from 'zod';
import { pageQuery } from '@/shared/pagination';
import {
  color,
  dateOnly,
  email,
  enumOf,
  freeText,
  iban,
  money,
  nationalId,
  objectId,
  optional,
  nullable,
  percent,
  personName,
  phone,
  basisPoints,
} from '@/shared/validation/fields';

export const STAFF_TYPES = ['dentist', 'hygienist', 'assistant', 'receptionist', 'accountant', 'hr', 'manager', 'other'] as const;

const amountLine = z.object({ componentId: objectId(), amount: money() });

export const compensationInput = z
  .object({
    basicSalary: money().optional(),
    allowances: z.array(amountLine).max(30).optional(),
    deductions: z.array(amountLine).max(30).optional(),
    socialSecurity: z.object({ enrolled: z.boolean(), employeeRateBp: basisPoints().optional(), employerRateBp: basisPoints().optional() }).optional(),
    commission: z
      .object({ basis: enumOf(['production', 'collection']), percent: percent(), appliesTo: z.array(z.string().max(40)).max(20).optional(), netOfLabCost: z.boolean().optional() })
      .nullable()
      .optional(),
  })
  .strict();

const staffWritable = {
  name: personName({ max: 120 }),
  phone: phone(),
  email: email(),
  address: freeText(300),
  gender: enumOf(['male', 'female']),
  dateOfBirth: dateOnly(),
  nationalId: nationalId(),
  nationality: z.string().length(2).toUpperCase(),
  jobTitle: freeText(80),
  staffType: enumOf([...STAFF_TYPES]),
  specialty: freeText(80),
  licenseNumber: freeText(40),
  licenseExpiry: dateOnly(),
  color: color(),
  bookableOnline: z.boolean(),
  defaultChairId: objectId(),
  shift: objectId(),
  employment: z
    .object({ type: enumOf(['full_time', 'part_time', 'contractor']), hireDate: optional(dateOnly()), endDate: optional(dateOnly()), probationEndDate: optional(dateOnly()) })
    .strict(),
  compensation: compensationInput,
  bank: z.object({ bankName: freeText(80), iban: optional(iban()) }).strict(),
};

export const staffUpdateBody = z
  .object({
    version: z.number().int().min(0),
    name: staffWritable.name.optional(),
    phone: nullable(staffWritable.phone),
    email: nullable(staffWritable.email),
    address: optional(staffWritable.address),
    gender: optional(staffWritable.gender),
    dateOfBirth: nullable(staffWritable.dateOfBirth),
    nationalId: nullable(staffWritable.nationalId),
    nationality: optional(staffWritable.nationality),
    jobTitle: optional(staffWritable.jobTitle),
    staffType: staffWritable.staffType.optional(),
    specialty: optional(staffWritable.specialty),
    licenseNumber: optional(staffWritable.licenseNumber),
    licenseExpiry: nullable(staffWritable.licenseExpiry),
    color: staffWritable.color.optional(),
    bookableOnline: staffWritable.bookableOnline.optional(),
    defaultChairId: nullable(staffWritable.defaultChairId),
    shift: nullable(staffWritable.shift),
    employment: staffWritable.employment.optional(),
    compensation: staffWritable.compensation.optional(),
    bank: staffWritable.bank.optional(),
  })
  .strict();
export type StaffUpdate = z.infer<typeof staffUpdateBody>;

export const staffInviteBody = z
  .object({
    name: staffWritable.name,
    email: optional(staffWritable.email),
    phone: optional(staffWritable.phone),
    staffType: staffWritable.staffType,
    jobTitle: optional(staffWritable.jobTitle),
    roleIds: z.array(objectId()).max(10).optional(),
    color: optional(staffWritable.color),
    specialty: optional(staffWritable.specialty),
    licenseNumber: optional(staffWritable.licenseNumber),
    licenseExpiry: optional(staffWritable.licenseExpiry),
    bookableOnline: z.boolean().optional(),
    compensation: compensationInput.optional(),
    employment: staffWritable.employment.optional(),
    sendInvite: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.email || v.phone, { path: ['email'], message: 'required' });
export type StaffInvite = z.infer<typeof staffInviteBody>;

export const staffListQuery = z
  .object({
    ...pageQuery,
    staffType: z.enum(STAFF_TYPES).optional(),
    status: z.enum(['active', 'inactive', 'terminated']).optional(),
    bookable: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type StaffListQuery = z.infer<typeof staffListQuery>;

export const idParams = z.object({ id: objectId() });

export const staffRolesBody = z.object({ roleIds: z.array(objectId()).max(10), isOwner: z.boolean().optional() }).strict();

const grantInput = z.object({
  permission: z.string().max(80),
  scope: z.enum(['own', 'all']).default('all'),
  fields: z.record(z.enum(['hidden', 'masked', 'read', 'write'])).optional(),
});
export const overridesBody = z
  .object({
    overrides: z.array(z.union([grantInput.strict(), z.object({ permission: z.string().max(80), revoked: z.literal(true) }).strict()])).max(200),
  })
  .strict();

export const deactivateBody = z.object({ status: z.enum(['inactive', 'terminated']), endDate: optional(dateOnly()), reason: freeText(500).optional() }).strict();
