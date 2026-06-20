import { application } from '@application'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { app } from 'electron'

// TODO(i18n-migration): main must not depend on renderer source. These locale
// JSON imports are a known cross-process boundary violation, intentionally left
// in place and deferred to the dedicated i18n migration PR (relocate locales to
// a shared on-disk resource loaded per-process via i18next-fs-backend). Do NOT
// add new renderer imports here.
import EnUs from '../../renderer/i18n/locales/en-us.json'
import ZhCn from '../../renderer/i18n/locales/zh-cn.json'
import ZhTw from '../../renderer/i18n/locales/zh-tw.json'
// Machine translation
import deDE from '../../renderer/i18n/translate/de-de.json'
import elGR from '../../renderer/i18n/translate/el-gr.json'
import esES from '../../renderer/i18n/translate/es-es.json'
import frFR from '../../renderer/i18n/translate/fr-fr.json'
import JaJP from '../../renderer/i18n/translate/ja-jp.json'
import ptPT from '../../renderer/i18n/translate/pt-pt.json'
import roRO from '../../renderer/i18n/translate/ro-ro.json'
import RuRu from '../../renderer/i18n/translate/ru-ru.json'
import viVN from '../../renderer/i18n/translate/vi-vn.json'

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
    ['pt-PT', ptPT],
    ['ro-RO', roRO],
    ['vi-VN', viVN]
  ].map(([locale, translation]) => [locale, { translation }])
)

export const getAppLanguage = (): LanguageVarious => {
  const language = application.get('PreferenceService').get('app.language')
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

/**
 * Get translation by key path (e.g., 'dialog.save_file')
 * This is a simplified version for main process, similar to i18next's t() function.
 *
 * Supports i18next-style `{{var}}` interpolation: pass `params` and any
 * `{{name}}` placeholder in the resolved string is replaced with `params.name`.
 * Placeholders without a matching param are left intact.
 */
export const t = (key: string, params?: Record<string, string | number>): string => {
  const locale = getI18n()
  const keys = key.split('.')
  let result: any = locale.translation
  for (const k of keys) {
    result = result?.[k]
    if (result === undefined) {
      return key
    }
  }
  if (typeof result !== 'string') {
    return key
  }
  if (!params) {
    return result
  }
  return result.replace(/\{\{\s*(\w+)\s*\}\}/g, (match: string, name: string) =>
    name in params ? String(params[name]) : match
  )
}
