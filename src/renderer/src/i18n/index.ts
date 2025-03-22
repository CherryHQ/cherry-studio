import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import elGR from './locales/el-gr.json'
import enUS from './locales/en-us.json'
import esES from './locales/es-es.json'
import frFR from './locales/fr-fr.json'
import jaJP from './locales/ja-jp.json'
import ptPT from './locales/pt-pt.json'
import ruRU from './locales/ru-ru.json'
import zhCN from './locales/zh-cn.json'
import zhTW from './locales/zh-tw.json'

const resources = {
  'el-GR': elGR,
  'en-US': enUS,
  'es-ES': esES,
  'fr-FR': frFR,
  'ja-JP': jaJP,
  'pt-PT': ptPT,
  'ru-RU': ruRU,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

export const getLanguage = () => {
  return localStorage.getItem('language') || navigator.language || 'en-US'
}

export const getLanguageCode = () => {
  return getLanguage().split('-')[0]
}

i18n.use(initReactI18next).init({
  resources,
  lng: getLanguage(),
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false
  }
})

export default i18n
