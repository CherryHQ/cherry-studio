import { defaultLanguage } from '@shared/config/constant'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Original translation
import bgBG from './locales/bg-bg.json'
import enUS from './locales/en-us.json'
import jaJP from './locales/ja-jp.json'
import ruRU from './locales/ru-ru.json'
import zhCN from './locales/zh-cn.json'
import zhTW from './locales/zh-tw.json'
// Machine translation
import arAR from './translate/ar-ar.json'
import deDE from './translate/de-de.json'
import elGR from './translate/el-gr.json'
import esES from './translate/es-es.json'
import frFR from './translate/fr-fr.json'
import idID from './translate/id-id.json'
import itIT from './translate/it-it.json'
import koKR from './translate/ko-kr.json'
import plPL from './translate/pl-pl.json'
import ptPT from './translate/pt-pt.json'
import thTH from './translate/th-th.json'
import trTR from './translate/tr-tr.json'
import ukUA from './translate/uk-ua.json'
import urPK from './translate/ur-pk.json'
import viVN from './translate/vi-vn.json'

const resources = {
  'ar-AR': arAR,
  'bg-BG': bgBG,
  'de-DE': deDE,
  'el-GR': elGR,
  'en-US': enUS,
  'es-ES': esES,
  'fr-FR': frFR,
  'id-ID': idID,
  'it-IT': itIT,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'pl-PL': plPL,
  'pt-PT': ptPT,
  'ru-RU': ruRU,
  'th-TH': thTH,
  'tr-TR': trTR,
  'uk-UA': ukUA,
  'ur-PK': urPK,
  'vi-VN': viVN,
  'zh-CN': zhCN,
  'zh-TW': zhTW
}

export const getLanguage = () => {
  return localStorage.getItem('language') || navigator.language || defaultLanguage
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
  }
})

export default i18n
