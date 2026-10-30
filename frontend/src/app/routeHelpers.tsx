import { Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { PlaceholderPage } from '@/shared/components/PlaceholderPage';
import { PageSkeleton } from '@/shared/components/States';
import { RequirePermission, type RouteHandle } from './guards';

export function page(
  element: ReactNode,
  handle: RouteHandle = {},
  path?: string,
  index?: boolean,
): RouteObject {
  const wrapped = (
    <RequirePermission>
      <Suspense fallback={<PageSkeleton />}>{element}</Suspense>
    </RequirePermission>
  );
  return index ? { index: true, element: wrapped, handle } : { path, element: wrapped, handle };
}

export function placeholder(path: string, titleKey: string, perm?: string): RouteObject {
  return page(<PlaceholderPage titleKey={titleKey} />, { perm, title: titleKey }, path);
}
