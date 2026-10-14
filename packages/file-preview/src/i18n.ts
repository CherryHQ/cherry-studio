import { createInstance, type i18n } from 'i18next'

import deDE from './locales/de-de.json'
import elGR from './locales/el-gr.json'
import enUS from './locales/en-us.json'
import esES from './locales/es-es.json'
import frFR from './locales/fr-fr.json'
import jaJP from './locales/ja-jp.json'
import ptPT from './locales/pt-pt.json'
import roRO from './locales/ro-ro.json'
import ruRU from './locales/ru-ru.json'
import trTR from './locales/tr-tr.json'
import viVN from './locales/vi-vn.json'
import zhCN from './locales/zh-cn.json'
import zhTW from './locales/zh-tw.json'

const catalogs = {
  'de-de': deDE,
  'el-gr': elGR,
  'en-us': enUS,
  'es-es': esES,
  'fr-fr': frFR,
  'ja-jp': jaJP,
  'pt-pt': ptPT,
  'ro-ro': roRO,
  'ru-ru': ruRU,
  'tr-tr': trTR,
  'vi-vn': viVN,
  'zh-cn': zhCN,
  'zh-tw': zhTW
}

export function createPreviewI18n(locale: string): i18n {
  const instance = createInstance()
  void instance.init({
    lng: locale.toLowerCase(),
    fallbackLng: 'en-us',
    supportedLngs: Object.keys(catalogs),
    lowerCaseLng: true,
    load: 'currentOnly',
    initImmediate: false,
    defaultNS: 'file-preview',
    resources: Object.fromEntries(
      Object.entries(catalogs).map(([language, catalog]) => [language, { 'file-preview': catalog }])
    ),
    interpolation: { escapeValue: false }
  })
  return instance
}
