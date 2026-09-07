import { application } from '@application'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { app } from 'electron'

import deDE from './locales/de-de.json'
import elGR from './locales/el-gr.json'
import EnUs from './locales/en-us.json'
import esES from './locales/es-es.json'
import frFR from './locales/fr-fr.json'
import JaJP from './locales/ja-jp.json'
import ptPT from './locales/pt-pt.json'
import roRO from './locales/ro-ro.json'
import RuRu from './locales/ru-ru.json'
import trTR from './locales/tr-tr.json'
import viVN from './locales/vi-vn.json'
import ZhCn from './locales/zh-cn.json'
import ZhTw from './locales/zh-tw.json'

const locales = Object.fromEntries(
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
    ['vi-VN', viVN],
    ['tr-TR', trTR]
  ].map(([locale, translation]) => [locale, { translation }])
)

/** Every language main carries a catalog for — the source of truth other modules should key off of. */
export const SUPPORTED_LANGUAGES = Object.keys(locales) as LanguageVarious[]

export const getAppLanguage = (): LanguageVarious => {
  const language = application.get('PreferenceService').get('app.language')
  const appLocale = app.getLocale()

  if (language) {
    return language
  }

  return (Object.keys(locales).includes(appLocale) ? appLocale : defaultLanguage) as LanguageVarious
}

/**
 * Get translation by key (e.g., 'dialog.save_file')
 * This is a simplified version for main process, similar to i18next's t() function.
 *
 * Catalogs are flat, so the dotted key is looked up literally — there is no path walk.
 *
 * Resolution order: `language` (defaults to the current app language), then the
 * en-US catalog, then the key itself. Supports i18next-style `{{var}}`
 * interpolation: pass `params` and any `{{name}}` placeholder in the resolved
 * string is replaced with `params.name`. Placeholders without a matching param
 * are left intact.
 *
 * The optional `language` override lets a caller resolve a string in a language
 * other than the app's current one — e.g. the API gateway's OpenAPI docs render
 * one translation per requested language, independent of `app.language`.
 */
export const t = (key: string, params?: Record<string, string | number>, language?: LanguageVarious): string => {
  const resolve = (translation: Record<string, string>): string | undefined => {
    const result = translation[key]
    return typeof result === 'string' && !result.startsWith('[to be translated]') ? result : undefined
  }

  const value =
    resolve(locales[language ?? getAppLanguage()].translation) ?? resolve(locales[defaultLanguage].translation)
  if (value === undefined) {
    return key
  }
  if (!params) {
    return value
  }
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (match: string, name: string) =>
    name in params ? String(params[name]) : match
  )
}
