import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Schema, model, type Types } from 'mongoose';
import { env } from '@/config/env';
import { applyBase } from '@/core/db/plugins';
import { ApiError } from '@/core/http/ApiError';
import { tenantField } from '@/core/tenancy/tenantPlugin';

/** StorageDriver interface (02 §9). Keys never contain user-supplied names. */
export type StorageDriver = {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
};

const root = resolve(env.UPLOAD_DIR);

export const localDriver: StorageDriver = {
  async put(key, data) {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('invalid key');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  },
  async get(key) {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('invalid key');
    return readFile(path);
  },
  async delete(key) {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('invalid key');
    await rm(path, { force: true });
  },
};

/** In tests files live in memory. */
const memory = new Map<string, Buffer>();
export const memoryDriver: StorageDriver = {
  async put(key, data) {
    memory.set(key, data);
  },
  async get(key) {
    const v = memory.get(key);
    if (!v) throw ApiError.notFound();
    return v;
  },
  async delete(key) {
    memory.delete(key);
  },
};

export function storage(): StorageDriver {
  return env.NODE_ENV === 'test' ? memoryDriver : localDriver;
}

const fileAssetSchema = new Schema(
  {
    clinicId: tenantField,
    ownerType: { type: String, enum: ['patient', 'staff', 'clinic', 'labOrder', 'consent', 'expense', 'issue', 'plan'], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    category: { type: String, enum: ['xray', 'photo', 'document', 'consent', 'id', 'signature', 'other'], default: 'document' },
    storageKey: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: String,
    originalName: { type: String, default: '' },
    toothNumbers: { type: [Number], default: undefined },
    takenAt: Date,
    notes: { type: String, default: '' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'fileAssets' },
);
applyBase(fileAssetSchema);
fileAssetSchema.index({ clinicId: 1, ownerType: 1, ownerId: 1, createdAt: -1 });
export const FileAssetModel = model('FileAsset', fileAssetSchema);

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

/**
 * Validates by magic bytes (never by extension), re-encodes images to strip EXIF/GPS,
 * stores under `clinics/{clinicId}/{ownerType}/{ownerId}/{uuid}.{ext}` (11 §6).
 */
export async function saveFile(input: {
  clinicId: string;
  ownerType: string;
  ownerId: string | Types.ObjectId;
  buffer: Buffer;
  originalName?: string;
  category?: string;
  userId?: string;
  toothNumbers?: number[];
  takenAt?: Date;
  notes?: string;
}) {
  if (input.buffer.length > env.MAX_UPLOAD_MB * 1024 * 1024) {
    throw ApiError.validation([{ path: 'file', code: 'file_too_large', params: { max: env.MAX_UPLOAD_MB } }]);
  }
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(input.buffer);
  const ext = detected ? ALLOWED.get(detected.mime) : undefined;
  if (!detected || !ext) {
    throw ApiError.validation([{ path: 'file', code: 'file_type_not_allowed', params: { types: 'JPEG, PNG, WebP, PDF' } }]);
  }
  let data = input.buffer;
  if (detected.mime.startsWith('image/')) {
    const sharp = (await import('sharp')).default;
    // rotate() applies EXIF orientation; re-encoding drops all metadata.
    data = await sharp(input.buffer).rotate().toFormat(ext === 'jpg' ? 'jpeg' : (ext as 'png' | 'webp'), { quality: 90 }).toBuffer();
  }
  const key = `clinics/${input.clinicId}/${input.ownerType}/${String(input.ownerId)}/${randomUUID()}.${ext}`;
  await storage().put(key, data, detected.mime);
  return FileAssetModel.create({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    category: input.category ?? 'document',
    storageKey: key,
    mime: detected.mime,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    originalName: (input.originalName ?? '').slice(0, 200),
    toothNumbers: input.toothNumbers,
    takenAt: input.takenAt,
    notes: input.notes ?? '',
    uploadedBy: input.userId,
  });
}
