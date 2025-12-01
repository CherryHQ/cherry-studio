/**
 * i18n initialization for migration window
 * Detects system language independently without relying on preferenceService
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { enUS, zhCN } from './locales'

/**
 * Detect system language independently
 * Rule: If system language contains 'zh', use Chinese, otherwise use English
 */
function detectLanguage(): 'zh-CN' | 'en-US' {
  const browserLang = navigator.language || navigator.languages?.[0] || 'en-US'

  // If contains 'zh' (zh, zh-CN, zh-TW, zh-HK, etc.), use Chinese
  return browserLang.toLowerCase().includes('zh') ? 'zh-CN' : 'en-US'
}

const language = detectLanguage()

/**
 * Initialize i18n asynchronously
 * Must be called and awaited before rendering components
 */
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
