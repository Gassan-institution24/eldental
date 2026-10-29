import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from './States';
import { PageHeader } from './PageHeader';

/** Used only for routes whose module lands in a later roadmap phase. */
export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <EmptyState icon={<Construction size={32} />} title={t('states.comingSoon')} />
    </>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return <EmptyState title={t('states.notFoundTitle')} description={t('states.notFoundBody')} />;
}
