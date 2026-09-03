/**
 * DashScope Qwen-MT translation model utilities.
 *
 * Qwen-MT is a translation-only model family. It does not take a translation
 * prompt — the target language is passed as
 * `providerOptions.<provider>.translation_options.target_lang` at request time
 * and the model returns the translated text directly.
 *
 * Drop-in restoration of the v1 helper that lived in
 * `src/renderer/config/translate.ts` before PR #14911 consolidated the AI
 * runtime into the main process. Without this, `translateService` was sending
 * the raw source text with no language hint (issue #19701).
 */
import type { TranslateLanguage } from '@shared/data/types/translate'

/**
 * Qwen-MT target-language code map. The model speaks dozens of locales; each
 * ISO 639-1 short code (or zh-region variant) maps to a Qwen-MT name.
 */
const QWEN_MT_LANG_MAP: Record<string, string> = {
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
  sv: 'Swedish',
  hu: 'Hungarian',
  da: 'Danish',
  fi: 'Finnian',
  uk: 'Ukrainian',
  bg: 'Bulgarian',
  sr: 'Serbian',
  te: 'Telugu',
  af: 'Afrikaans',
  hy: 'Armenian',
  as: 'Assamese',
  ast: 'Asturian',
  eu: 'Basque',
  be: 'Belarusian',
  bs: 'Bosnian',
  ca: 'Catalan',
  ceb: 'Cebuano',
  hr: 'Croatian',
  arz: 'Egyptian Arabic',
  et: 'Estonian',
  gl: 'Galician',
  ka: 'Georgian',
  gu: 'Gujarati',
  is: 'Icelandic',
  jv: 'Javanese',
  kn: 'Kannada',
  kk: 'Kazakh',
  lv: 'Latvian',
  lt: 'Lithuanian',
  lb: 'Luxembourgish',
  mk: 'Macedonian',
  mai: 'Maithili',
  mt: 'Maltese',
  mr: 'Marathi',
  acm: 'Mesopotamian Arabic',
  ary: 'Moroccan Arabic',
  ars: 'Najdi Arabic',
  ne: 'Nepali',
  az: 'North Azerbaijani',
  apc: 'North Levantine Arabic',
  uz: 'Northern Uzbek',
  nb: 'Norwegian Bokmål',
  nn: 'Norwegian Nynorsk',
  oc: 'Occitan',
  or: 'Odia',
  pag: 'Pangasinan',
  scn: 'Sicilian',
  sd: 'Sindhi',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  ajp: 'South Levantine Arabic',
  sw: 'Swahili',
  tl: 'Tagalog',
  acq: 'Ta\u2019izzi-Adeni Arabic',
  sq: 'Tosk Albanian',
  aeb: 'Tunisian Arabic',
  vec: 'Venetian',
  war: 'Waray',
  cy: 'Welsh',
  fa: 'Western Persian'
}

/**
 * Map a Cherry `TranslateLanguage` (with a `langCode` like `en`, `zh-cn`, `pt-br`)
 * to the Qwen-MT `target_lang` string the model expects.
 *
 * Returns `undefined` when the language is not in the Qwen-MT catalogue so the
 * caller can surface a clear `translate.error.not_supported` instead of letting
 * the model receive an empty target and reply with whatever it fancies.
 */
export function mapLanguageToQwenMTModel(language: TranslateLanguage): string | undefined {
  if (language.langCode === 'zh-cn') return 'Chinese'
  if (language.langCode === 'zh-tw') return 'Traditional Chinese'
  if (language.langCode === 'zh-yue') return 'Cantonese'
  const shortLangCode = language.langCode.split('-')[0]
  return QWEN_MT_LANG_MAP[shortLangCode]
}
