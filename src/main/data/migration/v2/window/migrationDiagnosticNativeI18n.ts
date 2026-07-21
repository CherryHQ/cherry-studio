import { createInstance } from 'i18next'

import resources from './migrationDiagnosticNativeI18n.json'

export type MigrationDiagnosticNativeLocale = 'en-US' | 'zh-CN'

export interface MigrationDiagnosticNativeI18n {
  readonly locale: MigrationDiagnosticNativeLocale
  t(key: string, params?: Readonly<Record<string, string | number>>): string
}

function normalizeLocale(locale: string): MigrationDiagnosticNativeLocale {
  const normalized = locale.replace('_', '-').toLowerCase()
  if (normalized === 'zh-cn' || normalized === 'zh-hans') return 'zh-CN'
  return 'en-US'
}

export async function createMigrationDiagnosticNativeI18n(locale: string): Promise<MigrationDiagnosticNativeI18n> {
  const resolvedLocale = normalizeLocale(locale)
  const instance = createInstance()
  await instance.init({
    lng: resolvedLocale,
    fallbackLng: 'en-US',
    resources,
    interpolation: { escapeValue: false },
    initImmediate: false
  })

  return Object.freeze({
    locale: resolvedLocale,
    t: (key: string, params?: Readonly<Record<string, string | number>>) => instance.t(key, params)
  })
}
