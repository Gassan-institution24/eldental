import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { env } from '@/config/env';

extendZodWithOpenApi(z);

export const openApiRegistry = new OpenAPIRegistry();

openApiRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

export const ErrorEnvelope = openApiRegistry.register(
  'ErrorEnvelope',
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
      requestId: z.string().optional(),
    }),
  }),
);

type PathDef = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  tags: string[];
  summary: string;
  body?: z.ZodTypeAny;
  query?: z.AnyZodObject;
  params?: z.AnyZodObject;
  response?: z.ZodTypeAny;
  isPublic?: boolean;
};

/** Small wrapper so modules register their routes in one line. */
export function registerPath(def: PathDef): void {
  openApiRegistry.registerPath({
    method: def.method,
    path: `${env.API_PREFIX}${def.path}`.replace(/:(\w+)/g, '{$1}'),
    tags: def.tags,
    summary: def.summary,
    ...(def.isPublic ? {} : { security: [{ bearerAuth: [] }] }),
    request: {
      ...(def.params ? { params: def.params } : {}),
      ...(def.query ? { query: def.query } : {}),
      ...(def.body ? { body: { content: { 'application/json': { schema: def.body } } } } : {}),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ data: def.response ?? z.unknown() }) } },
      },
      default: { description: 'Error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });
}

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(openApiRegistry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: `${env.APP_NAME} API`, version: env.APP_VERSION },
    servers: [{ url: env.API_PUBLIC_URL }],
  });
}
