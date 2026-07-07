/**
 * i18n initialization for the relocation window.
 *
 * Detects the system language independently (no preferenceService is
 * available this early in startup). Mirrors the migration window's
 * detection rule: Traditional Chinese locales get zh-TW, other Chinese
 * locales get zh-CN, everything else gets English.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { enUS, zhCN, zhTW } from './locales'

function detectLanguage(): 'zh-CN' | 'zh-TW' | 'en-US' {
  const browserLang = navigator.language || navigator.languages?.[0] || 'en-US'
  const normalized = browserLang.toLowerCase()
  if (normalized.includes('zh-tw') || normalized.includes('zh-hk') || normalized.includes('zh-mo')) {
    return 'zh-TW'
  }
  return normalized.includes('zh') ? 'zh-CN' : 'en-US'
}

const language = detectLanguage()

const initI18n = async () => {
  await i18n.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: zhCN },
      'zh-TW': { translation: zhTW },
      'en-US': { translation: enUS }
    },
    lng: language,
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false
    }
  })
}

export default i18n
export { initI18n }
