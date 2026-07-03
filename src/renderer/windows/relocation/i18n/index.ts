/**
 * i18n initialization for the relocation window.
 *
 * Detects the system language independently (no preferenceService is
 * available this early in startup). Mirrors the migration window's
 * detection rule: 'zh' anywhere in the locale → Chinese, else English.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { enUS, zhCN } from './locales'

function detectLanguage(): 'zh-CN' | 'en-US' {
  const browserLang = navigator.language || navigator.languages?.[0] || 'en-US'
  return browserLang.toLowerCase().includes('zh') ? 'zh-CN' : 'en-US'
}

const language = detectLanguage()

const initI18n = async () => {
  await i18n.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: zhCN },
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
