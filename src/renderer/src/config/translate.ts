import i18n from '@renderer/i18n'
import { Language } from '@renderer/types'

export const UNKNOWN: Language = {
  value: 'Unknown',
  langCode: 'unknown',
  label: () => i18n.t('languages.unknown'),
  emoji: '🏳️'
}

export const ENGLISH: Language = {
  value: 'English',
  langCode: 'en-us',
  label: () => i18n.t('languages.english'),
  emoji: '🇬🇧'
}

export const CHINESE_SIMPLIFIED: Language = {
  value: 'Chinese (Simplified)',
  langCode: 'zh-cn',
  label: () => i18n.t('languages.chinese'),
  emoji: '🇨🇳'
}

export const CHINESE_TRADITIONAL: Language = {
  value: 'Chinese (Traditional)',
  langCode: 'zh-tw',
  label: () => i18n.t('languages.chinese-traditional'),
  emoji: '🇭🇰'
}

export const JAPANESE: Language = {
  value: 'Japanese',
  langCode: 'ja-jp',
  label: () => i18n.t('languages.japanese'),
  emoji: '🇯🇵'
}

export const KOREAN: Language = {
  value: 'Korean',
  langCode: 'ko-kr',
  label: () => i18n.t('languages.korean'),
  emoji: '🇰🇷'
}

export const FRENCH: Language = {
  value: 'French',
  langCode: 'fr-fr',
  label: () => i18n.t('languages.french'),
  emoji: '🇫🇷'
}

export const GERMAN: Language = {
  value: 'German',
  langCode: 'de-de',
  label: () => i18n.t('languages.german'),
  emoji: '🇩🇪'
}

export const ITALIAN: Language = {
  value: 'Italian',
  langCode: 'it-it',
  label: () => i18n.t('languages.italian'),
  emoji: '🇮🇹'
}

export const SPANISH: Language = {
  value: 'Spanish',
  langCode: 'es-es',
  label: () => i18n.t('languages.spanish'),
  emoji: '🇪🇸'
}

export const PORTUGUESE: Language = {
  value: 'Portuguese',
  langCode: 'pt-pt',
  label: () => i18n.t('languages.portuguese'),
  emoji: '🇵🇹'
}

export const RUSSIAN: Language = {
  value: 'Russian',
  langCode: 'ru-ru',
  label: () => i18n.t('languages.russian'),
  emoji: '🇷🇺'
}

export const POLISH: Language = {
  value: 'Polish',
  langCode: 'pl-pl',
  label: () => i18n.t('languages.polish'),
  emoji: '🇵🇱'
}

export const ARABIC: Language = {
  value: 'Arabic',
  langCode: 'ar-ar',
  label: () => i18n.t('languages.arabic'),
  emoji: '🇸🇦'
}

export const TURKISH: Language = {
  value: 'Turkish',
  langCode: 'tr-tr',
  label: () => i18n.t('languages.turkish'),
  emoji: '🇹🇷'
}

export const THAI: Language = {
  value: 'Thai',
  langCode: 'th-th',
  label: () => i18n.t('languages.thai'),
  emoji: '🇹🇭'
}

export const VIETNAMESE: Language = {
  value: 'Vietnamese',
  langCode: 'vi-vn',
  label: () => i18n.t('languages.vietnamese'),
  emoji: '🇻🇳'
}

export const INDONESIAN: Language = {
  value: 'Indonesian',
  langCode: 'id-id',
  label: () => i18n.t('languages.indonesian'),
  emoji: '🇮🇩'
}

export const URDU: Language = {
  value: 'Urdu',
  langCode: 'ur-pk',
  label: () => i18n.t('languages.urdu'),
  emoji: '🇵🇰'
}

export const MALAY: Language = {
  value: 'Malay',
  langCode: 'ms-my',
  label: () => i18n.t('languages.malay'),
  emoji: '🇲🇾'
}

export const UKRAINIAN: Language = {
  value: 'Ukrainian',
  langCode: 'uk-ua',
  label: () => i18n.t('languages.ukrainian'),
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

export const translateLanguageOptions: Language[] = Object.values(LanguagesEnum)
