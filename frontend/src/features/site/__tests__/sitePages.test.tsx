import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { PublicLayout } from '@/layouts/PublicLayout';
import { HomePage } from '../pages/HomePage';
import { AboutPage, FeaturesPage, LegalPage, PricingPage, SecurityPage } from '../pages/InfoPages';
import { ContactPage } from '../pages/ContactPage';

const pages: [string, JSX.Element][] = [
  ['/', <HomePage key="h" />],
  ['/features', <FeaturesPage key="f" />],
  ['/pricing', <PricingPage key="p" />],
  ['/about', <AboutPage key="a" />],
  ['/security', <SecurityPage key="s" />],
  ['/contact', <ContactPage key="c" />],
  ['/privacy', <LegalPage key="pr" kind="privacy" />],
  ['/terms', <LegalPage key="t" kind="terms" />],
];

function renderAt(path: string) {
  const router = createMemoryRouter([{ element: <PublicLayout />, children: pages.map(([p, el]) => ({ path: p, element: el })) }], { initialEntries: [path] });
  return render(
    <AppThemeProvider>
      <QueryClientProvider client={new QueryClient()}>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </QueryClientProvider>
    </AppThemeProvider>,
  );
}

afterAll(() => void i18n.changeLanguage('en'));

describe('public website renders in both languages', () => {
  for (const lng of ['en', 'ar'] as const) {
    for (const [path] of pages) {
      it(`${lng} ${path}`, async () => {
        await i18n.changeLanguage(lng);
        renderAt(path);
        expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
        // No raw i18n keys leaked into the page.
        expect(document.body.textContent).not.toMatch(/\b(site|hero|features|pricing|legal|about)\.[a-z]+\.[a-zA-Z0-9]+\b/);
        expect(document.documentElement.dir).toBe(lng === 'ar' ? 'rtl' : 'ltr');
      });
    }
  }
});
