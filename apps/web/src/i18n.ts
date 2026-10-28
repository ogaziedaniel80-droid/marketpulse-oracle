import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_LOCALES = ['en', 'fr', 'ha', 'yo', 'ig', 'pcm', 'tw'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleCatalog {
  _meta: {
    locale: SupportedLocale;
    name: string;
    status: string;
  };
  [section: string]: Record<string, string>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '..', 'locales');

const catalogCache = new Map<SupportedLocale, LocaleCatalog>();

export function loadLocaleCatalog(locale: SupportedLocale): LocaleCatalog {
  const cached = catalogCache.get(locale);
  if (cached) return cached;

  const filePath = path.join(LOCALES_DIR, `${locale}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as LocaleCatalog;
  catalogCache.set(locale, parsed);
  return parsed;
}

export function loadAllLocales(): Record<SupportedLocale, LocaleCatalog> {
  const result = {} as Record<SupportedLocale, LocaleCatalog>;
  for (const loc of SUPPORTED_LOCALES) {
    result[loc] = loadLocaleCatalog(loc);
  }
  return result;
}

/**
 * Translate a dot-separated key (e.g. "reporter.stake_at_risk_warning")
 * in the requested locale, falling back safely to English ("en") if missing.
 */
export function t(
  locale: SupportedLocale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const [section, field] = key.split('.');
  const targetCatalog = loadLocaleCatalog(locale);
  const enCatalog = loadLocaleCatalog('en');

  const rawTemplate =
    targetCatalog?.[section]?.[field] ?? enCatalog?.[section]?.[field] ?? key;

  if (!vars) return rawTemplate;

  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    rawTemplate,
  );
}
