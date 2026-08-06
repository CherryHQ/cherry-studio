import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'

export type LanguageDirection = 'ltr' | 'rtl'

export interface AppLocaleDefinition {
  englishName: string
  direction: LanguageDirection
  /**
   * Extra BCP 47 tags that resolve to this locale. Only needed where the tag
   * differs from the locale id's own language subtag (script/region variants);
   * the bare subtag alias is what lets a system locale like `ar-SA` land here.
   */
  aliases?: readonly string[]
}

/**
 * The locale id doubles as the `<html lang>` tag, so stylesheets select these
 * with `:lang(ar)`, which matches the whole `ar-*` subtree rather than one id.
 */
export const appLocaleDefinitions = {
  'ar-YE': { englishName: 'Arabic', direction: 'rtl', aliases: ['ar'] },
  'de-DE': { englishName: 'German', direction: 'ltr', aliases: ['de'] },
  'el-GR': { englishName: 'Greek', direction: 'ltr', aliases: ['el'] },
  'en-US': { englishName: 'English', direction: 'ltr', aliases: ['en'] },
  'es-ES': { englishName: 'Spanish', direction: 'ltr', aliases: ['es'] },
  'fr-FR': { englishName: 'French', direction: 'ltr', aliases: ['fr'] },
  'ja-JP': { englishName: 'Japanese', direction: 'ltr', aliases: ['ja'] },
  'pt-PT': { englishName: 'Portuguese', direction: 'ltr', aliases: ['pt'] },
  'ro-RO': { englishName: 'Romanian', direction: 'ltr', aliases: ['ro'] },
  'ru-RU': { englishName: 'Russian', direction: 'ltr', aliases: ['ru'] },
  'vi-VN': { englishName: 'Vietnamese', direction: 'ltr', aliases: ['vi'] },
  'zh-CN': {
    englishName: 'Chinese (Simplified)',
    direction: 'ltr',
    aliases: ['zh', 'zh-hans', 'zh-sg']
  },
  'zh-TW': {
    englishName: 'Chinese (Traditional)',
    direction: 'ltr',
    aliases: ['zh-hant', 'zh-hk', 'zh-mo']
  }
} satisfies Record<LanguageVarious, AppLocaleDefinition>

export const languageEnglishNameMap = Object.fromEntries(
  Object.entries(appLocaleDefinitions).map(([language, definition]) => [language, definition.englishName])
) as Record<LanguageVarious, string>

/** Native-script display name for each language. */
export const languageNativeNameMap: Record<LanguageVarious, string> = {
  'ar-YE': 'العربية',
  'zh-CN': '中文',
  'zh-TW': '中文（繁体）',
  'en-US': 'English',
  'de-DE': 'Deutsch',
  'ja-JP': '日本語',
  'ru-RU': 'Русский',
  'el-GR': 'Ελληνικά',
  'es-ES': 'Español',
  'fr-FR': 'Français',
  'pt-PT': 'Português',
  'ro-RO': 'Română',
  'vi-VN': 'Tiếng Việt'
}

export const defaultLanguage: LanguageVarious = 'en-US'

const supportedLanguages = Object.keys(appLocaleDefinitions) as LanguageVarious[]

function normalizeLocale(language: string): string {
  return language.replaceAll('_', '-').toLowerCase()
}

export function resolveAppLanguage(language: string | null | undefined): LanguageVarious {
  if (!language) return defaultLanguage

  const normalizedLanguage = normalizeLocale(language)
  const exactMatch = supportedLanguages.find((candidate) => candidate.toLowerCase() === normalizedLanguage)
  if (exactMatch) return exactMatch

  const aliasMatch = supportedLanguages.find((candidate) =>
    appLocaleDefinitions[candidate].aliases?.includes(normalizedLanguage)
  )
  if (aliasMatch) return aliasMatch

  const baseLanguage = normalizedLanguage.split('-')[0]
  const baseMatches = supportedLanguages.filter((candidate) =>
    appLocaleDefinitions[candidate].aliases?.includes(baseLanguage)
  )
  return baseMatches.length === 1 ? baseMatches[0] : defaultLanguage
}

export function getLanguageDirection(language: LanguageVarious): LanguageDirection {
  return appLocaleDefinitions[language].direction
}
