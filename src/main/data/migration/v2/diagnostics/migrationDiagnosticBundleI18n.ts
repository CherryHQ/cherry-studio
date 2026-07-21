import { createInstance } from 'i18next'

import resources from './migrationDiagnosticBundleI18n.json'

const BUNDLE_README_LOCALES = ['en-US', 'zh-CN'] as const

export async function createMigrationDiagnosticBundleReadme(): Promise<string> {
  const instance = createInstance()
  await instance.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    resources,
    interpolation: { escapeValue: false },
    initImmediate: false
  })

  return `${BUNDLE_README_LOCALES.map((locale) => instance.getFixedT(locale)('readme')).join('\n\n')}\n`
}
