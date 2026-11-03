import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';

const grantSchema = new Schema(
  {
    permission: { type: String, required: true },
    scope: { type: String, enum: ['own', 'all'], default: 'all' },
    fields: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const roleFields = {
  key: { type: String, required: true, trim: true },
  /** null → shown via `seed.roles.<systemKey>` until renamed (03 §1.1). */
  name: { type: String, trim: true, default: null },
  systemKey: String,
  description: { type: String, default: '' },
  permissions: { type: [grantSchema], default: [] },
  isSystem: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
};

/** Clinic roles (tenant). */
const roleSchema = new Schema({ clinicId: tenantField, ...roleFields }, { timestamps: true, collection: 'roles' });
applyBase(roleSchema);
roleSchema.index({ clinicId: 1, key: 1 }, { unique: true });

export type Role = InferSchemaType<typeof roleSchema>;
export type RoleDoc = HydratedDocument<Role>;
export const RoleModel = model('Role', roleSchema);

/** Global role templates (`clinicId: null` in the spec), editable by `platform.catalog.manage`. */
const roleTemplateSchema = new Schema(roleFields, { timestamps: true, collection: 'roleTemplates' });
// Set when the platform edits a template; the seed then stops overwriting it from code.
roleTemplateSchema.add({ customizedAt: Date });
applyBase(roleTemplateSchema, { tenant: false });
roleTemplateSchema.index({ key: 1 }, { unique: true });
export const RoleTemplateModel = model('RoleTemplate', roleTemplateSchema);
