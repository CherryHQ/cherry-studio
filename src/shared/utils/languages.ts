import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'

export const languageEnglishNameMap: Record<LanguageVarious, string> = {
  'ar-YE': 'Arabic',
  'de-DE': 'German',
  'el-GR': 'Greek',
  'en-US': 'English',
  'es-ES': 'Spanish',
  'fr-FR': 'French',
  'ja-JP': 'Japanese',
  'pt-PT': 'Portuguese',
  'ro-RO': 'Romanian',
  'ru-RU': 'Russian',
  'zh-CN': 'Chinese (Simplified)',
  'vi-VN': 'Vietnamese',
  'zh-TW': 'Chinese (Traditional)'
}

export const defaultLanguage = 'en-US'

export type LanguageDirection = 'ltr' | 'rtl'

const supportedLanguages = Object.keys(languageEnglishNameMap) as LanguageVarious[]

export function resolveAppLanguage(language: string | null | undefined): LanguageVarious {
  if (!language) return defaultLanguage

  const normalizedLanguage = language.replace('_', '-').toLowerCase()
  const exactMatch = supportedLanguages.find((candidate) => candidate.toLowerCase() === normalizedLanguage)
  if (exactMatch) return exactMatch

  const baseLanguage = normalizedLanguage.split('-')[0]
  return (
    supportedLanguages.find((candidate) => candidate.toLowerCase().split('-')[0] === baseLanguage) ?? defaultLanguage
  )
}

export function getLanguageDirection(language: LanguageVarious): LanguageDirection {
  return language === 'ar-YE' ? 'rtl' : 'ltr'
}
