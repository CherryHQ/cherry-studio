import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { defaultLanguage } from '@shared/config/constant'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { app } from 'electron'
import i18n from 'i18next'

import enUS from '../../renderer/src/i18n/locales/en-us.json'
import zhCN from '../../renderer/src/i18n/locales/zh-cn.json'
import zhTW from '../../renderer/src/i18n/locales/zh-tw.json'
// import deDE from '../../renderer/src/i18n/locales/de-de.json'
// import elGR from '../../renderer/src/i18n/locales/el-gr.json'
// import esES from '../../renderer/src/i18n/locales/es-es.json'
// import frFR from '../../renderer/src/i18n/locales/fr-fr.json'
// import JaJP from '../../renderer/src/i18n/locales/ja-jp.json'
// import ptPT from '../../renderer/src/i18n/locales/pt-pt.json'
// import RuRu from '../../renderer/src/i18n/locales/ru-ru.json'
import deDE from '../../renderer/src/i18n/translate/de-de.json'
import elGR from '../../renderer/src/i18n/translate/el-gr.json'
import esES from '../../renderer/src/i18n/translate/es-es.json'
import frFR from '../../renderer/src/i18n/translate/fr-fr.json'
import jaJP from '../../renderer/src/i18n/translate/ja-jp.json'
import ptPT from '../../renderer/src/i18n/translate/pt-pt.json'
import ruRU from '../../renderer/src/i18n/translate/ru-ru.json'

const logger = loggerService.withContext('main:i18n')

// const resources = Object.fromEntries([
//   ['en-US', enUS],
//   ['zh-CN', zhCN],
//   ['zh-TW', zhTW],
//   ['de-DE', deDE],
//   ['el-GR', elGR],
//   ['es-ES', esES],
//   ['fr-FR', frFR],
//   ['ja-JP', jaJP],
//   ['pt-PT', ptPT],
//   ['ru-RU', ruRU]
// ] as const)
const resources = Object.fromEntries(
  (
    [
      ['en-US', enUS],
      ['zh-CN', zhCN],
      ['zh-TW', zhTW],
      ['de-DE', deDE],
      ['el-GR', elGR],
      ['es-ES', esES],
      ['fr-FR', frFR],
      ['ja-JP', jaJP],
      ['pt-PT', ptPT],
      ['ru-RU', ruRU]
    ] as const
  ).map(([key, translation]) => [key, { translation }])
)

export const getAppLanguage = (): LanguageVarious => {
  const language = preferenceService.get('app.language')
  const appLocale = app.getLocale()

  if (language) {
    return language
  }

  return (Object.keys(resources).includes(appLocale) ? appLocale : defaultLanguage) as LanguageVarious
}

export const getI18n = (): Record<string, any> => {
  const language = getAppLanguage()
  return resources[language]
}

let t: (key: string) => string = () => {
  logger.error('i18n not inialized')
  return ''
}

let changeLang: (lang: LanguageVarious) => void = () => {
  logger.error('i18n not inialized')
}

i18n
  .init({
    resources,
    lng: getAppLanguage(),
    fallbackLng: defaultLanguage,
    ns: 'translation',
    interpolation: {
      escapeValue: false
    },
    saveMissing: true,
    missingKeyHandler: (_1, _2, key) => {
      logger.error(`Missing key: ${key}`)
    }
  })
  .then((tfn) => {
    changeLang = (lang: LanguageVarious) => {
      i18n.changeLanguage(lang)
    }
    t = (key: string) => tfn(key)
    const lng = getAppLanguage()
    logger.debug('i18n context', { lng, resource: resources[lng] })
  })

export { changeLang, i18n, t }
