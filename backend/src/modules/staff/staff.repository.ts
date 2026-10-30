import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import type { FieldPolicy } from '@/core/rbac/resolve';
import { projectionFor } from '@/core/rbac/fieldPolicy';
import { escapeRegex, toSearchName } from '@/shared/validation/normalize';
import { StaffModel, type Staff, type StaffDoc } from './staff.model';

/** API field → storage paths when they differ (for the hidden-field projection). */
export const STAFF_DB_PATHS: Record<string, readonly string[]> = {
  nationalId: ['nationalIdEnc', 'nationalIdLast4'],
  bank: ['bank'],
  photo: ['avatarFileId'],
  roles: ['roleIds'],
  shift: ['shiftId'],
};

function selectFor(policy: FieldPolicy): Record<string, 0> {
  return projectionFor(policy, STAFF_DB_PATHS);
}

/** Forces select:false fields in only when the caller may see them (masked or visible). */
function plusFields(policy: FieldPolicy): string {
  const out: string[] = [];
  if (policy.visible.has('nationalId') || policy.masked.has('nationalId')) out.push('+nationalIdEnc');
  if (policy.visible.has('bank') || policy.masked.has('bank')) out.push('+bank.ibanEnc');
  return out.join(' ');
}

export type ListArgs = { filter: FilterQuery<Staff>; q?: string; sort: Record<string, 1 | -1>; skip: number; limit: number };

export const staffRepository = {
  async list(policy: FieldPolicy, a: ListArgs) {
    const filter: FilterQuery<Staff> = { ...a.filter };
    if (a.q) filter.searchName = { $regex: escapeRegex(toSearchName(a.q)) };
    const query = StaffModel.find(filter).select(selectFor(policy)).sort(a.sort).skip(a.skip).limit(a.limit);
    const plus = plusFields(policy);
    if (plus) query.select(plus);
    const [items, total] = await Promise.all([query.lean(), StaffModel.countDocuments(filter)]);
    return { items, total };
  },
  async findOne(policy: FieldPolicy, filter: FilterQuery<Staff>) {
    const query = StaffModel.findOne(filter).select(selectFor(policy));
    const plus = plusFields(policy);
    if (plus) query.select(plus);
    return query.lean();
  },
  findDoc(filter: FilterQuery<Staff>, session?: ClientSession): Promise<StaffDoc | null> {
    return StaffModel.findOne(filter, null, { session }).select('+nationalIdEnc +bank.ibanEnc');
  },
  create(data: Partial<Staff>, session?: ClientSession): Promise<StaffDoc> {
    return new StaffModel(data).save({ session });
  },
  countActive(filter: FilterQuery<Staff> = {}) {
    return StaffModel.countDocuments({ ...filter, status: 'active' });
  },
  byIds(ids: (string | Types.ObjectId)[]) {
    return StaffModel.find({ _id: { $in: ids } }).select('name staffType color status').lean();
  },
};
