import { z } from 'zod';

const schema = z.object({
  VITE_APP_NAME: z.string().default('ElDental'),
  VITE_API_URL: z.string().url(),
  VITE_SOCKET_URL: z.string().url(),
  VITE_DEFAULT_LANG: z.enum(['ar', 'en']).default('ar'),
  VITE_DEFAULT_TIMEZONE: z.string().default('Asia/Amman'),
  VITE_DEFAULT_CURRENCY: z.string().length(3).default('JOD'),
  VITE_APP_VERSION: z.string().default('0.1.0'),
  VITE_FULLCALENDAR_LICENSE_KEY: z.string().default('GPL-My-Project-Is-Open-Source'),
});

const parsed = schema.safeParse({
  VITE_API_URL: 'http://localhost:4000/api/v1',
  VITE_SOCKET_URL: 'http://localhost:4000',
  ...import.meta.env,
});

if (!parsed.success) {
  throw new Error(`Invalid frontend env: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
}

export const env = {
  appName: parsed.data.VITE_APP_NAME,
  apiUrl: parsed.data.VITE_API_URL.replace(/\/$/, ''),
  socketUrl: parsed.data.VITE_SOCKET_URL,
  defaultLang: parsed.data.VITE_DEFAULT_LANG,
  defaultTimezone: parsed.data.VITE_DEFAULT_TIMEZONE,
  defaultCurrency: parsed.data.VITE_DEFAULT_CURRENCY,
  appVersion: parsed.data.VITE_APP_VERSION,
  fullCalendarLicenseKey: parsed.data.VITE_FULLCALENDAR_LICENSE_KEY,
  isDev: import.meta.env.DEV,
  isTest: import.meta.env.MODE === 'test',
} as const;
