import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/axios';

/**
 * Private files are served only through the authorised `/files/:id` endpoint (11 §6). An <img>
 * can't send the bearer token, so we fetch a blob and hand out an object URL.
 */
export function useFileUrl(fileId: string | undefined) {
  const q = useQuery({
    queryKey: ['file-blob', fileId],
    enabled: Boolean(fileId),
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const res = await api.get<Blob>(`/files/${fileId}`, { responseType: 'blob', silent: true });
      return URL.createObjectURL(res.data);
    },
  });
  // Object URLs live as long as the cache entry; several components may share one.
  return q;
}

/** Opens a private file in a new tab (PDFs, full-size images). */
export async function openFile(fileId: string, download = false) {
  const res = await api.get<Blob>(`/files/${fileId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.click();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
