import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enUS from './locales/en-us.json'
import ruRU from './locales/ru-ru.json'
import zhCN from './locales/zh-cn.json'
import zhTW from './locales/zh-tw.json'

const resources = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ru-RU': ruRU
}

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('language') || navigator.language || 'en-US',
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false
  }
})

export default i18n
