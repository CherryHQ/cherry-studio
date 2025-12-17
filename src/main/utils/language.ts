import { preferenceService } from '@data/PreferenceService'
import { defaultLanguage } from '@shared/config/constant'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { app } from 'electron'

import EnUs from '../../renderer/src/i18n/locales/en-us.json'
import ZhCn from '../../renderer/src/i18n/locales/zh-cn.json'
import ZhTw from '../../renderer/src/i18n/locales/zh-tw.json'
// Machine translation
import deDE from '../../renderer/src/i18n/translate/de-de.json'
import elGR from '../../renderer/src/i18n/translate/el-gr.json'
import esES from '../../renderer/src/i18n/translate/es-es.json'
import frFR from '../../renderer/src/i18n/translate/fr-fr.json'
import JaJP from '../../renderer/src/i18n/translate/ja-jp.json'
import ptPT from '../../renderer/src/i18n/translate/pt-pt.json'
import RuRu from '../../renderer/src/i18n/translate/ru-ru.json'

export const locales = Object.fromEntries(
  [
    ['en-US', EnUs],
    ['zh-CN', ZhCn],
    ['zh-TW', ZhTw],
    ['ja-JP', JaJP],
    ['ru-RU', RuRu],
    ['de-DE', deDE],
    ['el-GR', elGR],
    ['es-ES', esES],
    ['fr-FR', frFR],
    ['pt-PT', ptPT]
  ].map(([locale, translation]) => [locale, { translation }])
)

export const getAppLanguage = (): LanguageVarious => {
  const language = preferenceService.get('app.language')
  const appLocale = app.getLocale()

  if (language) {
    return language
  }

  return (Object.keys(locales).includes(appLocale) ? appLocale : defaultLanguage) as LanguageVarious
}

export const getI18n = (): Record<string, any> => {
  const language = getAppLanguage()
  return locales[language]
}
