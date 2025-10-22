// 为了支持自定义语言，设置为string别名
/** zh-cn, en-us, etc. */
export type TranslateLanguageCode = string

// langCode应当能够唯一确认一种语言
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

/** 有限的UI语言 */
export type LanguageVarious = 'zh-CN' | 'zh-TW' | 'el-GR' | 'en-US' | 'es-ES' | 'fr-FR' | 'ja-JP' | 'pt-PT' | 'ru-RU'
