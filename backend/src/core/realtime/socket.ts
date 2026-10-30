import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { createRedisConnection, isRedisAvailable } from '@/config/redis';
import { buildAuthContext } from '@/core/auth/authenticate';
import { registerRuntime } from '@/runtime';

/**
 * Socket.IO (02 §8). Clients authenticate with the access token in the handshake and join
 * `clinic:{id}` (staff) or `user:{id}` rooms. Payloads carry ids only: clients refetch through
 * the API, so field rules and scope still apply.
 */
let io: Server | null = null;

export function broadcastToClinic(clinicId: string, event: string, payload: Record<string, unknown>): void {
  io?.to(`clinic:${clinicId}`).emit(event, payload);
}

export function sendToUser(userId: string, event: string, payload: Record<string, unknown>): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

registerRuntime({
  start(server?: HttpServer) {
    if (!server) return;
    io = new Server(server, { path: '/socket.io', cors: { origin: env.CORS_ORIGINS, credentials: true } });
    if (isRedisAvailable()) io.adapter(createAdapter(createRedisConnection(), createRedisConnection()));
    io.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown }).token;
      if (typeof token !== 'string') return next(new Error('UNAUTHENTICATED'));
      buildAuthContext(token)
        .then((auth) => {
          socket.data.auth = { userId: auth.userId, clinicId: auth.clinicId, kind: auth.kind };
          next();
        })
        .catch(() => next(new Error('UNAUTHENTICATED')));
    });
    io.on('connection', (socket) => {
      const a = socket.data.auth as { userId: string; clinicId?: string; kind: string };
      void socket.join(`user:${a.userId}`);
      if (a.kind === 'staff' && a.clinicId) void socket.join(`clinic:${a.clinicId}`);
    });
    logger.info('socket.io ready');
  },
  async stop() {
    await io?.close();
    io = null;
  },
});
