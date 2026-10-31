import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { env } from '@/config/env';
import { useAuthStore } from '@/stores/authStore';

type Listener = (payload: Record<string, unknown>) => void;
const listeners = new Map<string, Set<Listener>>();
let socket: Socket | null = null;
let socketToken: string | null = null;

function connect(token: string): void {
  if (socket && socketToken === token) return;
  socket?.disconnect();
  socketToken = token;
  socket = io(env.socketUrl, { path: '/socket.io', auth: { token }, transports: ['websocket'] });
  socket.onAny((event: string, payload: Record<string, unknown>) => {
    listeners.get(event)?.forEach((l) => l(payload));
  });
}

function disconnect(): void {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

/** Subscribes to a server event while the component is mounted. */
export function useSocketEvent(event: string, listener: Listener): void {
  useEffect(() => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(event, set);
    return () => {
      set.delete(listener);
    };
  }, [event, listener]);
}

/**
 * Keeps one Socket.IO connection for the signed-in session (02 §8). Payloads carry ids only;
 * we refetch through the API so field rules and scope still apply.
 */
export function useRealtime(): void {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  useEffect(() => {
    if (env.isTest) return;
    if (!token) {
      disconnect();
      return;
    }
    connect(token);
  }, [token]);
  const onAppointment = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['availability'] });
  }, [qc]);
  useSocketEvent('appointment:changed', onAppointment);
  const onNotification = useCallback(
    () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
    [qc],
  );
  useSocketEvent('notification:new', onNotification);
}
