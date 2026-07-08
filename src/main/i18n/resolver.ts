import { application } from '@application'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { app } from 'electron'

// Main process owns an independent, statically-imported locale catalog (this
// directory), mirroring the renderer's locales/ (human) + translate/ (machine)
// split. It carries only the keys main actually renders — app menu, tray,
// dialogs, context menu, the OAuth callback page and a few shared strings — so
// importing all 12 languages up front costs ~48 KB.
import EnUs from './locales/en-us.json'
import ZhCn from './locales/zh-cn.json'
import ZhTw from './locales/zh-tw.json'
// Machine translation
import deDE from './translate/de-de.json'
import elGR from './translate/el-gr.json'
import esES from './translate/es-es.json'
import frFR from './translate/fr-fr.json'
import JaJP from './translate/ja-jp.json'
import ptPT from './translate/pt-pt.json'
import roRO from './translate/ro-ro.json'
import RuRu from './translate/ru-ru.json'
import viVN from './translate/vi-vn.json'

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
 * Resolution order: the current app language, then the en-US catalog, then the key
 * itself. Supports i18next-style `{{var}}` interpolation: pass `params` and any
 * `{{name}}` placeholder in the resolved string is replaced with `params.name`.
 * Placeholders without a matching param are left intact.
 */
export const t = (key: string, params?: Record<string, string | number>): string => {
  const resolve = (translation: any): string | undefined => {
    let result: any = translation
    for (const k of key.split('.')) {
      result = result?.[k]
      if (result === undefined) {
        return undefined
      }
    }
    return typeof result === 'string' ? result : undefined
  }

  const value = resolve(getI18n().translation) ?? resolve(locales[defaultLanguage].translation)
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
