import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'

export const languageEnglishNameMap: Record<LanguageVarious, string> = {
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
  'zh-TW': 'Chinese (Traditional)',
  'tr-TR': 'Turkish'
}

/** Native-script display name for each language — mirrors the labels in AppearanceSettings' language picker. */
export const languageNativeNameMap: Record<LanguageVarious, string> = {
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
  'vi-VN': 'Tiếng Việt',
  'tr-TR': 'Türkçe'
}

export const defaultLanguage = 'en-US'
