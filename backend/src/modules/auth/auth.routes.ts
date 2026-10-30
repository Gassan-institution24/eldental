import { Router, type CookieOptions, type Request, type Response } from 'express';
import { env } from '@/config/env';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { noContent, ok } from '@/core/http/response';
import { publicRoute } from '@/core/http/routeMeta';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import { body, params, validate } from '@/core/validation/validate';
import * as s from './auth.schemas';
import * as auth from './auth.service';
import type { IssuedRefresh } from './session.service';

export const authRouter = Router();

const cookiePath = `${env.API_PREFIX}/auth`;

function cookieOptions(remember: boolean, expiresAt?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: cookiePath,
    ...(env.COOKIE_DOMAIN && env.COOKIE_DOMAIN !== 'localhost' ? { domain: env.COOKIE_DOMAIN } : {}),
    // Without "remember this device" the cookie lives for the browser session only.
    ...(remember && expiresAt ? { expires: expiresAt } : {}),
  };
}

function setRefreshCookie(res: Response, r: IssuedRefresh | undefined): void {
  if (r) res.cookie(env.REFRESH_COOKIE_NAME, r.raw, cookieOptions(r.remember, r.expiresAt));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.REFRESH_COOKIE_NAME, { ...cookieOptions(false), expires: undefined });
}

const readCookie = (req: Request): string | undefined => {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[env.REFRESH_COOKIE_NAME];
  return typeof v === 'string' ? v : undefined;
};

function sendLogin(res: Response, result: auth.LoginResult) {
  setRefreshCookie(res, result.refresh);
  const { refresh: _r, ...rest } = result;
  return ok(res, rest);
}

authRouter.post('/auth/login', publicRoute(), validate({ body: s.loginBody }), asyncHandler(async (req, res) => sendLogin(res, await auth.login(body(req, s.loginBody)))));

authRouter.post(
  '/auth/login/mfa',
  publicRoute(),
  validate({ body: s.loginMfaBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.loginMfaBody);
    sendLogin(res, await auth.loginMfa(b.mfaToken, b.code));
  }),
);

authRouter.post(
  '/auth/refresh',
  publicRoute(),
  asyncHandler(async (req, res) => {
    try {
      const r = await auth.refresh(readCookie(req));
      setRefreshCookie(res, r.refresh);
      ok(res, { accessToken: r.accessToken });
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }),
);

authRouter.post(
  '/auth/select-clinic',
  authorize.self('staff'),
  validate({ body: s.selectClinicBody }),
  asyncHandler(async (req, res) => ok(res, await auth.selectClinic(req.auth!, body(req, s.selectClinicBody).clinicId, readCookie(req)))),
);

authRouter.post(
  '/auth/logout',
  publicRoute(),
  asyncHandler(async (req, res) => {
    await auth.logout(req.auth, readCookie(req));
    clearRefreshCookie(res);
    noContent(res);
  }),
);

authRouter.post(
  '/auth/logout-all',
  authorize.self(),
  asyncHandler(async (req, res) => {
    await auth.logoutAll(req.auth!);
    clearRefreshCookie(res);
    noContent(res);
  }),
);

authRouter.get('/auth/me', authorize.self(), asyncHandler(async (req, res) => ok(res, await auth.me(req.auth!))));

authRouter.post(
  '/auth/password/forgot',
  publicRoute(),
  validate({ body: s.forgotBody }),
  asyncHandler(async (req, res) => {
    await auth.forgotPassword(body(req, s.forgotBody).target);
    noContent(res);
  }),
);

authRouter.post(
  '/auth/password/reset',
  publicRoute(),
  validate({ body: s.resetBody }),
  asyncHandler(async (req, res) => {
    await auth.resetPassword(body(req, s.resetBody));
    noContent(res);
  }),
);

authRouter.post(
  '/auth/password/change',
  authorize.self(),
  validate({ body: s.changePasswordBody }),
  asyncHandler(async (req, res) => ok(res, await auth.changePassword(req.auth!, body(req, s.changePasswordBody), readCookie(req)))),
);

authRouter.get(
  '/auth/invitations/:token',
  publicRoute(),
  validate({ params: s.invitationParams }),
  asyncHandler(async (req, res) => ok(res, await auth.invitationInfo(params(req, s.invitationParams).token))),
);

authRouter.post(
  '/auth/invitations/accept',
  publicRoute(),
  validate({ body: s.acceptInvitationBody }),
  asyncHandler(async (req, res) => sendLogin(res, await auth.acceptInvitation(body(req, s.acceptInvitationBody)))),
);

authRouter.post(
  '/auth/mfa/setup',
  publicRoute(),
  validate({ body: s.mfaSetupBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.mfaSetupBody);
    if (!b.mfaToken && !req.auth) throw ApiError.unauthenticated();
    ok(res, await auth.mfaSetup({ mfaToken: b.mfaToken, auth: req.auth }));
  }),
);

authRouter.post(
  '/auth/mfa/enable',
  publicRoute(),
  validate({ body: s.mfaEnableBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.mfaEnableBody);
    if (!b.mfaToken && !req.auth) throw ApiError.unauthenticated();
    sendLogin(res, await auth.mfaEnable({ code: b.code, mfaToken: b.mfaToken, auth: req.auth }));
  }),
);

authRouter.post(
  '/auth/mfa/disable',
  authorize.self(),
  validate({ body: s.mfaDisableBody }),
  asyncHandler(async (req, res) => {
    await auth.mfaDisable(req.auth!, body(req, s.mfaDisableBody).code);
    noContent(res);
  }),
);

authRouter.post(
  '/auth/verify/send',
  authorize.self(),
  validate({ body: s.verifySendBody }),
  asyncHandler(async (req, res) => {
    await auth.sendVerification(req.auth!, body(req, s.verifySendBody).channel);
    noContent(res);
  }),
);

authRouter.post(
  '/auth/verify/confirm',
  authorize.self(),
  validate({ body: s.verifyConfirmBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.verifyConfirmBody);
    await auth.confirmVerification(req.auth!, b.channel, b.code);
    noContent(res);
  }),
);

registerPath({ method: 'post', path: '/auth/login', tags: ['auth'], summary: 'Sign in', body: s.loginBody, isPublic: true });
registerPath({ method: 'post', path: '/auth/login/mfa', tags: ['auth'], summary: 'Second factor', body: s.loginMfaBody, isPublic: true });
registerPath({ method: 'post', path: '/auth/refresh', tags: ['auth'], summary: 'Rotate refresh token (cookie)', isPublic: true });
registerPath({ method: 'post', path: '/auth/select-clinic', tags: ['auth'], summary: 'Clinic-scoped access token', body: s.selectClinicBody });
registerPath({ method: 'post', path: '/auth/logout', tags: ['auth'], summary: 'Revoke current session', isPublic: true });
registerPath({ method: 'post', path: '/auth/logout-all', tags: ['auth'], summary: 'Revoke all sessions' });
registerPath({ method: 'get', path: '/auth/me', tags: ['auth'], summary: 'Current user, clinic, staff and grants' });
registerPath({ method: 'post', path: '/auth/password/forgot', tags: ['auth'], summary: 'Send reset code', body: s.forgotBody, isPublic: true });
registerPath({ method: 'post', path: '/auth/password/reset', tags: ['auth'], summary: 'Reset with code', body: s.resetBody, isPublic: true });
registerPath({ method: 'post', path: '/auth/password/change', tags: ['auth'], summary: 'Change password', body: s.changePasswordBody });
registerPath({ method: 'post', path: '/auth/invitations/accept', tags: ['auth'], summary: 'Accept staff invitation', body: s.acceptInvitationBody, isPublic: true });
