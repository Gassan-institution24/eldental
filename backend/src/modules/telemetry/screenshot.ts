import type { Types } from 'mongoose';

type SaveFn = (dataUrl: string, clinicId?: string) => Promise<Types.ObjectId | undefined>;
let impl: SaveFn | undefined;

/** The files module registers how screenshots are stored (private storage, never public). */
export function setScreenshotSaver(fn: SaveFn): void {
  impl = fn;
}

export function saveScreenshotHook(): SaveFn | undefined {
  return impl;
}
