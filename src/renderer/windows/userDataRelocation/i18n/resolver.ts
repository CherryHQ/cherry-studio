import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { relocationLocales } from './locales'

function detectLanguage(): keyof typeof relocationLocales {
  const language = (navigator.language || navigator.languages?.[0] || 'en').toLowerCase()
  if (language.includes('zh-tw') || language.includes('zh-hk')) return 'zh-TW'
  if (language.includes('zh')) return 'zh-CN'
  return 'en'
}

export async function initI18n() {
  await i18n.use(initReactI18next).init({
    resources: relocationLocales,
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  })
}

export default i18n
