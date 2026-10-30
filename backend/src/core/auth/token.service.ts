import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '@/config/env';
import { ApiError } from '../http/ApiError';
import type { AuthKind } from './auth.types';

/** Access-token claims (04 §6.1, 11 §1). */
export type AccessClaims = {
  sub: string;
  kind: AuthKind;
  cid?: string;
  sid?: string;
  own?: boolean;
  pv?: number;
  imp?: string;
  ro?: boolean;
  /** patient id(s) this portal token may act for (self). */
  pid?: string;
};

export type VerifiedClaims = AccessClaims & { iat: number; exp: number; jti: string };

export function signAccessToken(claims: AccessClaims): string {
  const opts: SignOptions = { algorithm: 'HS256', expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'], jwtid: randomUUID() };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, opts);
}

/** Verifies the signature (never decode-only, 11 §1), accepting the previous secret during rotation. */
export function verifyAccessToken(token: string): VerifiedClaims {
  const secrets = [env.JWT_ACCESS_SECRET, env.JWT_ACCESS_SECRET_PREVIOUS].filter((s): s is string => Boolean(s));
  let lastErr: unknown;
  for (const secret of secrets) {
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload & VerifiedClaims;
      if (!payload.sub || !payload.kind) throw new Error('bad claims');
      return payload;
    } catch (err) {
      lastErr = err;
      if (err instanceof jwt.TokenExpiredError) throw new ApiError(401, 'TOKEN_EXPIRED', 'Access token expired');
    }
  }
  void lastErr;
  throw new ApiError(401, 'TOKEN_INVALID', 'Invalid access token');
}

export function accessTokenTtlSeconds(): number {
  const m = /^(\d+)([smhd])$/.exec(env.JWT_ACCESS_TTL);
  if (!m) return 900;
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as const)[m[2] as 's' | 'm' | 'h' | 'd'];
}
