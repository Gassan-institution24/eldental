import type { AuthContext } from '@/core/auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      id: string;
      sessionId?: string;
      auth?: AuthContext;
      /** Parsed and normalised input from `validate()`. */
      valid: { body?: unknown; query?: unknown; params?: unknown };
      /** Route metadata set by authorize()/public() (used by the route-meta test and logs). */
      routeMeta?: { permission?: string; public?: boolean };
    }
  }
}

export {};
