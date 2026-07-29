import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'

export type LanguageDirection = 'ltr' | 'rtl'

export interface AppLocaleDefinition {
  englishName: string
  htmlLanguage: string
  direction: LanguageDirection
  aliases?: readonly string[]
}

export const appLocaleDefinitions = {
  'ar-YE': { englishName: 'Arabic', htmlLanguage: 'ar', direction: 'rtl', aliases: ['ar'] },
  'de-DE': { englishName: 'German', htmlLanguage: 'de-DE', direction: 'ltr', aliases: ['de'] },
  'el-GR': { englishName: 'Greek', htmlLanguage: 'el-GR', direction: 'ltr', aliases: ['el'] },
  'en-US': { englishName: 'English', htmlLanguage: 'en-US', direction: 'ltr', aliases: ['en'] },
  'es-ES': { englishName: 'Spanish', htmlLanguage: 'es-ES', direction: 'ltr', aliases: ['es'] },
  'fr-FR': { englishName: 'French', htmlLanguage: 'fr-FR', direction: 'ltr', aliases: ['fr'] },
  'ja-JP': { englishName: 'Japanese', htmlLanguage: 'ja-JP', direction: 'ltr', aliases: ['ja'] },
  'pt-PT': { englishName: 'Portuguese', htmlLanguage: 'pt-PT', direction: 'ltr', aliases: ['pt'] },
  'ro-RO': { englishName: 'Romanian', htmlLanguage: 'ro-RO', direction: 'ltr', aliases: ['ro'] },
  'ru-RU': { englishName: 'Russian', htmlLanguage: 'ru-RU', direction: 'ltr', aliases: ['ru'] },
  'vi-VN': { englishName: 'Vietnamese', htmlLanguage: 'vi-VN', direction: 'ltr', aliases: ['vi'] },
  'zh-CN': {
    englishName: 'Chinese (Simplified)',
    htmlLanguage: 'zh-CN',
    direction: 'ltr',
    aliases: ['zh', 'zh-hans', 'zh-sg']
  },
  'zh-TW': {
    englishName: 'Chinese (Traditional)',
    htmlLanguage: 'zh-TW',
    direction: 'ltr',
    aliases: ['zh-hant', 'zh-hk', 'zh-mo']
  }
} satisfies Record<LanguageVarious, AppLocaleDefinition>

export const languageEnglishNameMap = Object.fromEntries(
  Object.entries(appLocaleDefinitions).map(([language, definition]) => [language, definition.englishName])
) as Record<LanguageVarious, string>

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

export function getAppLocaleDefinition(language: LanguageVarious): AppLocaleDefinition {
  return appLocaleDefinitions[language]
}

export function getLanguageDirection(language: LanguageVarious): LanguageDirection {
  return getAppLocaleDefinition(language).direction
}
