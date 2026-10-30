import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  api,
  deleteData,
  getData,
  getPaged,
  patchData,
  postData,
  type Paged,
} from '@/lib/api/axios';

export type Entity = { id: string; version: number };
export type ListParams = Record<string, string | number | boolean | undefined>;

/** Query-key factory + hooks for one REST resource (10 §5). */
export function resourceHooks<T extends Entity, C = Partial<T>, U = Partial<T>>(path: string) {
  const keys = {
    all: [path] as QueryKey,
    list: (params?: ListParams) => [path, 'list', params ?? {}] as QueryKey,
    detail: (id: string) => [path, 'detail', id] as QueryKey,
  };

  const clean = (params?: ListParams) =>
    Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== ''));

  function useList(params?: ListParams, opts: { enabled?: boolean } = {}) {
    return useQuery({
      queryKey: keys.list(params),
      queryFn: () => getPaged<T>(path, clean(params)),
      placeholderData: keepPreviousData,
      enabled: opts.enabled ?? true,
    });
  }

  /** Unpaged lists (chairs, appointment types…) return `data` as an array. */
  function useAll(params?: ListParams, opts: { enabled?: boolean } = {}) {
    return useQuery({
      queryKey: keys.list({ ...params, all: true }),
      queryFn: () => getData<T[]>(path, { params: clean(params) }),
      enabled: opts.enabled ?? true,
    });
  }

  function useItem(id: string | undefined) {
    return useQuery({
      queryKey: keys.detail(id ?? ''),
      queryFn: () => getData<T>(`${path}/${id}`),
      enabled: Boolean(id),
    });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: C) => postData<T>(path, body),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
    });
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, ...body }: U & { id: string; version: number }) =>
        patchData<T>(`${path}/${id}`, body),
      onSuccess: (data) => {
        qc.setQueryData(keys.detail(data.id), data);
        void qc.invalidateQueries({ queryKey: keys.all });
      },
    });
  }

  function useRemove() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => deleteData(`${path}/${id}`),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
    });
  }

  function useRestore() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => postData<T>(`${path}/${id}/restore`),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
    });
  }

  return { keys, useList, useAll, useItem, useCreate, useUpdate, useRemove, useRestore };
}

export type { Paged };
export { api };
