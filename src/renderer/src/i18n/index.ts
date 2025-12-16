import { loggerService } from '@logger'
import { defaultLanguage } from '@shared/config/constant'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Original translation
import enUS from './locales/en-us.json'
import zhCN from './locales/zh-cn.json'
import zhTW from './locales/zh-tw.json'
// Machine translation
import deDE from './translate/de-de.json'
import elGR from './translate/el-gr.json'
import esES from './translate/es-es.json'
import frFR from './translate/fr-fr.json'
import jaJP from './translate/ja-jp.json'
import ptPT from './translate/pt-pt.json'
import ruRU from './translate/ru-ru.json'

const logger = loggerService.withContext('I18N')

const resources = Object.fromEntries(
  [
    ['en-US', enUS],
    ['ja-JP', jaJP],
    ['ru-RU', ruRU],
    ['zh-CN', zhCN],
    ['zh-TW', zhTW],
    ['de-DE', deDE],
    ['el-GR', elGR],
    ['es-ES', esES],
    ['fr-FR', frFR],
    ['pt-PT', ptPT]
  ].map(([locale, translation]) => [locale, { translation }])
)

export const getLanguage = () => {
  let savedLanguage: string | null = null
  try {
    savedLanguage =
      typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function'
        ? window.localStorage.getItem('language')
        : null
  } catch {
    savedLanguage = null
  }

  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : undefined

  return savedLanguage || browserLanguage || defaultLanguage
}

export const getLanguageCode = () => {
  return getLanguage().split('-')[0]
}

i18n.use(initReactI18next).init({
  resources,
  lng: getLanguage(),
  fallbackLng: defaultLanguage,
  interpolation: {
    escapeValue: false
  },
  saveMissing: true,
  missingKeyHandler: (_1, _2, key) => {
    logger.error(`Missing key: ${key}`)
  }
})

export default i18n
