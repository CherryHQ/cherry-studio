import * as z from 'zod'

/**
 * Language code pattern used for translation features.
 * Examples: "zh-cn", "en-us", "fr-fr", etc.
 * Must be lowercase and follow the format: 2-3 letter language code
 * followed by a hyphen and 2-letter region code.
 */
export const TranslateLanguageCodeSchema = z.string().regex(/^[a-z]{2,3}(-[a-z]{2,3})$/)

export type TranslateLanguageCode = z.infer<typeof TranslateLanguageCodeSchema> // langCode应当能够唯一确认一种语言

export type TranslateLanguage = {
  value: string
  langCode: TranslateLanguageCode
  label: () => string
  emoji: string
}

export interface TranslateHistory {
  id: string
  sourceText: string
  targetText: string
  sourceLanguage: TranslateLanguageCode
  targetLanguage: TranslateLanguageCode
  createdAt: string
  /** 收藏状态 */
  star?: boolean
}

export type CustomTranslateLanguage = {
  id: string
  langCode: TranslateLanguageCode
  value: string
  emoji: string
}

export const AutoDetectionMethods = {
  franc: 'franc',
  llm: 'llm',
  auto: 'auto'
} as const

export type AutoDetectionMethod = keyof typeof AutoDetectionMethods

export const isAutoDetectionMethod = (method: string): method is AutoDetectionMethod => {
  return Object.hasOwn(AutoDetectionMethods, method)
}
