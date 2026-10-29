import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { env } from '@/config/env';

export const LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

type Catalog = Record<string, unknown>;
const modules = import.meta.glob<Catalog>('../locales/*/*.json', { eager: true, import: 'default' });

/** { ar: { common: {...}, validation: {...} }, en: {...} } built from the locale files. */
export const resources: Record<string, Record<string, Catalog>> = {};
for (const [path, catalog] of Object.entries(modules)) {
  const m = /locales\/(\w+)\/([\w-]+)\.json$/.exec(path);
  if (!m) continue;
  const [, lng, ns] = m as unknown as [string, string, string];
  resources[lng] = resources[lng] ?? {};
  (resources[lng] as Record<string, Catalog>)[ns] = catalog;
}

export const NAMESPACES = Object.keys(resources.en ?? {});

export const dirOf = (lng: string): 'rtl' | 'ltr' => (lng.startsWith('ar') ? 'rtl' : 'ltr');

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: NAMESPACES,
    defaultNS: 'common',
    fallbackNS: 'common',
    fallbackLng: env.defaultLang,
    supportedLngs: [...LANGUAGES],
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'eld.lang', caches: ['localStorage'] },
    returnNull: false,
  });

function applyDocumentLanguage(lng: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lng;
  document.documentElement.dir = dirOf(lng);
}
applyDocumentLanguage(i18n.resolvedLanguage ?? env.defaultLang);
i18n.on('languageChanged', applyDocumentLanguage);

export default i18n;
