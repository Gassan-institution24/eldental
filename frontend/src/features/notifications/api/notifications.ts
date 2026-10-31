import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, postData } from '@/lib/api/axios';
import { useAuthStore } from '@/stores/authStore';

export type AppNotification = {
  id: string;
  type: string;
  title?: string;
  body?: string;
  titleKey?: string;
  bodyKey?: string;
  params?: Record<string, string | number>;
  link?: string;
  readAt?: string | null;
  createdAt: string;
};

export const notificationKeys = { all: ['notifications'] as const };

export function useNotifications() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: notificationKeys.all,
    enabled: Boolean(token),
    refetchInterval: 120_000,
    queryFn: () =>
      getData<{ items: AppNotification[]; unread: number }>('/notifications', {
        params: { limit: 20 },
        silent: true,
      }),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postData(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postData('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
