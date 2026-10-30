import { Router } from 'express';
import { Schema, model } from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '@/core/http/asyncHandler';
import { created } from '@/core/http/response';
import { publicRoute } from '@/core/http/routeMeta';
import { publicBookingRateLimit } from '@/core/http/security';
import { registerPath } from '@/core/openapi/registry';
import { requestContext } from '@/core/context/requestContext';
import { body, validate } from '@/core/validation/validate';
import { email, entityName, enumOf, freeText, optional, personName, phone } from '@/shared/validation/fields';

/** Leads from the marketing site's contact / demo form (platform-level, no tenant). */
const contactRequestSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    clinicName: String,
    clinicSize: String,
    interest: String,
    plan: String,
    message: String,
    locale: String,
    status: { type: String, enum: ['new', 'contacted', 'closed'], default: 'new' },
    ip: String,
    userAgent: String,
  },
  { timestamps: true, collection: 'contactRequests' },
);
contactRequestSchema.index({ createdAt: -1 });
export const ContactRequestModel = model('ContactRequest', contactRequestSchema);

export const contactBody = z
  .object({
    name: personName({ max: 120 }),
    email: email(),
    phone: optional(phone()),
    clinicName: optional(entityName()),
    clinicSize: optional(enumOf(['s1', 's2', 's3', 's4'])),
    interest: enumOf(['demo', 'pricing', 'migration', 'other']),
    plan: optional(enumOf(['starter', 'pro', 'enterprise'])),
    message: optional(freeText(2000)),
    locale: optional(enumOf(['ar', 'en'])),
  })
  .strict();

export const contactRouter = Router();

contactRouter.post(
  '/public/contact',
  publicRoute(),
  publicBookingRateLimit,
  validate({ body: contactBody }),
  asyncHandler(async (req, res) => {
    const ctx = requestContext.get();
    const doc = await ContactRequestModel.create({ ...body(req, contactBody), ip: ctx?.ip, userAgent: ctx?.userAgent });
    created(res, { id: String(doc._id) });
  }),
);

registerPath({ method: 'post', path: '/public/contact', tags: ['public'], summary: 'Contact / demo request from the website', body: contactBody, isPublic: true });
