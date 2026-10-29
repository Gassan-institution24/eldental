import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requestContext } from '../context/requestContext';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Assigns `req.id`, reads `X-Session-Id`, and opens the request's AsyncLocalStorage scope. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  const session = req.header('x-session-id');
  req.sessionId = session && SAFE_ID.test(session) ? session : undefined;
  res.setHeader('X-Request-Id', req.id);
  requestContext.run(
    {
      reqId: req.id,
      sessionId: req.sessionId,
      ip: req.ip,
      userAgent: req.header('user-agent')?.slice(0, 300),
    },
    () => next(),
  );
};
