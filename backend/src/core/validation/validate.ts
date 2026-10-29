import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ApiError, type ValidationField } from '../http/ApiError';
import { zodErrorToFields } from './zodIssues';

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

/** Parses body/query/params with Zod, stores the result in `req.valid`, or throws 422. */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const fields: ValidationField[] = [];
    req.valid = req.valid ?? {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) req.valid[part] = result.data;
      else fields.push(...zodErrorToFields(result.error, part));
    }
    if (fields.length) return next(ApiError.validation(fields));
    next();
  };
}

/** Typed accessors for controllers. */
export function body<S extends ZodTypeAny>(req: { valid: { body?: unknown } }, _s?: S): z.infer<S> {
  return req.valid.body as z.infer<S>;
}
export function query<S extends ZodTypeAny>(req: { valid: { query?: unknown } }, _s?: S): z.infer<S> {
  return req.valid.query as z.infer<S>;
}
export function params<S extends ZodTypeAny>(req: { valid: { params?: unknown } }, _s?: S): z.infer<S> {
  return req.valid.params as z.infer<S>;
}
