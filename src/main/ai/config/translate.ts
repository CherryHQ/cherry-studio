/**
 * Qwen-MT language mapping.
 *
 * Port of `mapLanguageToQwenMTModel` from `src/renderer/src/config/translate.ts`
 * (origin/main). We only port the mapping itself, not the i18n-bound
 * TranslateLanguage constants — Main accepts a minimal `{ langCode }` shape.
 */

export const QwenMTMap: Record<string, string> = {
  en: 'English',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  de: 'German',
  it: 'Italian',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  ar: 'Arabic',
  hi: 'Hindi',
  he: 'Hebrew',
  my: 'Burmese',
  ta: 'Tamil',
  ur: 'Urdu',
  bn: 'Bengali',
  pl: 'Polish',
  nl: 'Dutch',
  ro: 'Romanian',
  tr: 'Turkish',
  km: 'Khmer',
  lo: 'Lao',
  yue: 'Cantonese',
  cs: 'Czech',
  el: 'Greek',
  sv: 'Swedish'
}

/** Minimal language shape accepted by the mapper (matches renderer `TranslateLanguage`). */
export interface QwenMTLanguageInput {
  langCode: string
}

/**
 * Map a BCP-47-style language code to the Qwen-MT `target_lang` string.
 * Returns `undefined` when the language is unknown or unsupported by Qwen-MT.
 */
export function mapLanguageToQwenMTModel(language: QwenMTLanguageInput): string | undefined {
  if (language.langCode === 'unknown') return undefined

  // Chinese regions map explicitly — Qwen-MT treats them as distinct targets.
  if (language.langCode === 'zh-cn') return 'Chinese'
  if (language.langCode === 'zh-tw') return 'Traditional Chinese'
  if (language.langCode === 'zh-yue') return 'Cantonese'

  const shortLangCode = language.langCode.split('-')[0]
  return QwenMTMap[shortLangCode]
}
