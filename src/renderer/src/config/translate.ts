import type { TranslateLanguage } from '@renderer/types'

export const UNKNOWN: TranslateLanguage = {
  value: 'Unknown',
  langCode: 'unknown',
  emoji: '🏳️'
}

export const ENGLISH: TranslateLanguage = {
  value: 'English',
  langCode: 'en-us',
  emoji: '🇬🇧'
}

export const CHINESE_SIMPLIFIED: TranslateLanguage = {
  value: 'Chinese (Simplified)',
  langCode: 'zh-cn',
  emoji: '🇨🇳'
}

export const CHINESE_TRADITIONAL: TranslateLanguage = {
  value: 'Chinese (Traditional)',
  langCode: 'zh-tw',
  emoji: '🇭🇰'
}

export const JAPANESE: TranslateLanguage = {
  value: 'Japanese',
  langCode: 'ja-jp',
  emoji: '🇯🇵'
}

export const KOREAN: TranslateLanguage = {
  value: 'Korean',
  langCode: 'ko-kr',
  emoji: '🇰🇷'
}

export const FRENCH: TranslateLanguage = {
  value: 'French',
  langCode: 'fr-fr',
  emoji: '🇫🇷'
}

export const GERMAN: TranslateLanguage = {
  value: 'German',
  langCode: 'de-de',
  emoji: '🇩🇪'
}

export const ITALIAN: TranslateLanguage = {
  value: 'Italian',
  langCode: 'it-it',
  emoji: '🇮🇹'
}

export const SPANISH: TranslateLanguage = {
  value: 'Spanish',
  langCode: 'es-es',
  emoji: '🇪🇸'
}

export const PORTUGUESE: TranslateLanguage = {
  value: 'Portuguese',
  langCode: 'pt-pt',
  emoji: '🇵🇹'
}

export const RUSSIAN: TranslateLanguage = {
  value: 'Russian',
  langCode: 'ru-ru',
  emoji: '🇷🇺'
}

export const POLISH: TranslateLanguage = {
  value: 'Polish',
  langCode: 'pl-pl',
  emoji: '🇵🇱'
}

export const ARABIC: TranslateLanguage = {
  value: 'Arabic',
  langCode: 'ar-ar',
  emoji: '🇸🇦'
}

export const TURKISH: TranslateLanguage = {
  value: 'Turkish',
  langCode: 'tr-tr',
  emoji: '🇹🇷'
}

export const THAI: TranslateLanguage = {
  value: 'Thai',
  langCode: 'th-th',
  emoji: '🇹🇭'
}

export const VIETNAMESE: TranslateLanguage = {
  value: 'Vietnamese',
  langCode: 'vi-vn',
  emoji: '🇻🇳'
}

export const INDONESIAN: TranslateLanguage = {
  value: 'Indonesian',
  langCode: 'id-id',
  emoji: '🇮🇩'
}

export const URDU: TranslateLanguage = {
  value: 'Urdu',
  langCode: 'ur-pk',
  emoji: '🇵🇰'
}

export const MALAY: TranslateLanguage = {
  value: 'Malay',
  langCode: 'ms-my',
  emoji: '🇲🇾'
}

export const UKRAINIAN: TranslateLanguage = {
  value: 'Ukrainian',
  langCode: 'uk-ua',
  emoji: '🇺🇦'
}

export const LanguagesEnum = {
  enUS: ENGLISH,
  zhCN: CHINESE_SIMPLIFIED,
  zhTW: CHINESE_TRADITIONAL,
  jaJP: JAPANESE,
  koKR: KOREAN,
  frFR: FRENCH,
  deDE: GERMAN,
  itIT: ITALIAN,
  esES: SPANISH,
  ptPT: PORTUGUESE,
  ruRU: RUSSIAN,
  plPL: POLISH,
  arAR: ARABIC,
  trTR: TURKISH,
  thTH: THAI,
  viVN: VIETNAMESE,
  idID: INDONESIAN,
  urPK: URDU,
  msMY: MALAY,
  ukUA: UKRAINIAN
} as const

export const builtinLanguages: TranslateLanguage[] = Object.values(LanguagesEnum)

export const builtinLangCodeList = builtinLanguages.map((lang) => lang.langCode)

const QwenMTMap = {
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
  fi: 'Finnish',
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
  acq: 'Ta’izzi-Adeni Arabic',
  sq: 'Tosk Albanian',
  aeb: 'Tunisian Arabic',
  vec: 'Venetian',
  war: 'Waray',
  cy: 'Welsh',
  fa: 'Western Persian'
}

export function mapLanguageToQwenMTModel(language: TranslateLanguage): string | undefined {
  if (language.langCode === UNKNOWN.langCode) {
    return undefined
  }
  // 中文的多个地区需要单独处理
  if (language.langCode === 'zh-cn') {
    return 'Chinese'
  }
  if (language.langCode === 'zh-tw') {
    return 'Traditional Chinese'
  }
  if (language.langCode === 'zh-yue') {
    return 'Cantonese'
  }
  const shortLangCode = language.langCode.split('-')[0]
  return QwenMTMap[shortLangCode]
}
