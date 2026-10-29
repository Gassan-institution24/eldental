import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getData } from '@/lib/api/axios';
import type { SearchProvider } from '@/layouts/shell/GlobalSearch';

type Hit = { id: string; fullName: string; fileNumber: string; phone?: string };

/** Global search provider: fast patient typeahead (`/patients/search`). */
export function usePatientSearchProvider(): SearchProvider {
  const navigate = useNavigate();
  const { t } = useTranslation('nav');
  return useCallback<SearchProvider>(
    async (q) => {
      const hits = await getData<Hit[]>('/patients/search', { params: { q, limit: 8 }, silent: true }).catch(() => []);
      return hits.map((h) => ({
        id: h.id,
        title: h.fullName,
        subtitle: [h.fileNumber, h.phone].filter(Boolean).join(' · '),
        group: t('patients'),
        onSelect: () => navigate(`/clinic/patients/${h.id}`),
      }));
    },
    [navigate, t],
  );
}
