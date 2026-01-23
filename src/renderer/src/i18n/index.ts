import 'dayjs/locale/de'
import 'dayjs/locale/el'
import 'dayjs/locale/es'
import 'dayjs/locale/fr'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt'
import 'dayjs/locale/ro'
import 'dayjs/locale/ru'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

import { loggerService } from '@logger'
import { defaultLanguage } from '@shared/config/constant'
import dayjs from 'dayjs'
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
import roRO from './translate/ro-ro.json'
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
    ['pt-PT', ptPT],
    ['ro-RO', roRO]
  ].map(([locale, translation]) => [locale, { translation }])
)

export const getLanguage = () => {
  return localStorage.getItem('language') || navigator.language || defaultLanguage
}

export const getLanguageCode = () => {
  return getLanguage().split('-')[0]
}

// Map i18n language codes to dayjs locale codes
const dayjsLocaleMap: Record<string, string> = {
  'en-US': 'en',
  'ja-JP': 'ja',
  'ru-RU': 'ru',
  'zh-CN': 'zh-cn',
  'zh-TW': 'zh-tw',
  'de-DE': 'de',
  'el-GR': 'el',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'pt-PT': 'pt',
  'ro-RO': 'ro'
}

export const setDayjsLocale = (language: string) => {
  const dayjsLocale = dayjsLocaleMap[language] || 'en'
  dayjs.locale(dayjsLocale)
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
