/**
 * Builtin translate languages — pure data, no i18n or renderer dependencies.
 *
 * Used by:
 * - Main process seeding (insert into translate_language table on first run)
 * - Renderer process (identify builtin vs user-created languages)
 */

import type { TranslateLangCode } from '../preference/preferenceTypes'

/**
 * Enum-like constant object of all builtin translate languages.
 * Access individual languages via `BUILTIN_LANGUAGE.enUS`, `BUILTIN_LANGUAGE.zhCN`, etc.
 */
export const BUILTIN_LANGUAGE = {
  enUS: { langCode: 'en-us', value: 'English', emoji: '🇺🇸' },
  zhCN: { langCode: 'zh-cn', value: 'Chinese (Simplified)', emoji: '🇨🇳' },
  zhTW: { langCode: 'zh-tw', value: 'Chinese (Traditional)', emoji: '🇭🇰' },
  jaJP: { langCode: 'ja-jp', value: 'Japanese', emoji: '🇯🇵' },
  koKR: { langCode: 'ko-kr', value: 'Korean', emoji: '🇰🇷' },
  frFR: { langCode: 'fr-fr', value: 'French', emoji: '🇫🇷' },
  deDE: { langCode: 'de-de', value: 'German', emoji: '🇩🇪' },
  itIT: { langCode: 'it-it', value: 'Italian', emoji: '🇮🇹' },
  esES: { langCode: 'es-es', value: 'Spanish', emoji: '🇪🇸' },
  ptPT: { langCode: 'pt-pt', value: 'Portuguese', emoji: '🇵🇹' },
  ruRU: { langCode: 'ru-ru', value: 'Russian', emoji: '🇷🇺' },
  plPL: { langCode: 'pl-pl', value: 'Polish', emoji: '🇵🇱' },
  arSA: { langCode: 'ar-sa', value: 'Arabic', emoji: '🇸🇦' },
  trTR: { langCode: 'tr-tr', value: 'Turkish', emoji: '🇹🇷' },
  thTH: { langCode: 'th-th', value: 'Thai', emoji: '🇹🇭' },
  viVN: { langCode: 'vi-vn', value: 'Vietnamese', emoji: '🇻🇳' },
  idID: { langCode: 'id-id', value: 'Indonesian', emoji: '🇮🇩' },
  urPK: { langCode: 'ur-pk', value: 'Urdu', emoji: '🇵🇰' },
  msMY: { langCode: 'ms-my', value: 'Malay', emoji: '🇲🇾' },
  ukUA: { langCode: 'uk-ua', value: 'Ukrainian', emoji: '🇺🇦' }
} as const satisfies Record<string, { langCode: TranslateLangCode; value: string; emoji: string }>

/** Flat array of all builtin translate languages, derived from {@link BUILTIN_LANGUAGE}. */
export const BUILTIN_TRANSLATE_LANGUAGES = Object.values(BUILTIN_LANGUAGE)

/** Maps each {@link TranslateLangCode} to its corresponding i18n translation key. */
export const langCodeToI18nKey = new Map(
  Object.entries({
    'en-us': 'languages.english',
    'zh-cn': 'languages.chinese',
    'zh-tw': 'languages.chinese-traditional',
    'ja-jp': 'languages.japanese',
    'ko-kr': 'languages.korean',
    'fr-fr': 'languages.french',
    'de-de': 'languages.german',
    'it-it': 'languages.italian',
    'es-es': 'languages.spanish',
    'pt-pt': 'languages.portuguese',
    'ru-ru': 'languages.russian',
    'pl-pl': 'languages.polish',
    'ar-sa': 'languages.arabic',
    'tr-tr': 'languages.turkish',
    'th-th': 'languages.thai',
    'vi-vn': 'languages.vietnamese',
    'id-id': 'languages.indonesian',
    'ur-pk': 'languages.urdu',
    'ms-my': 'languages.malay',
    'uk-ua': 'languages.ukrainian',
    unknown: 'languages.unknown'
  } satisfies Record<(typeof BUILTIN_LANGUAGE)[keyof typeof BUILTIN_LANGUAGE]['langCode'] | 'unknown', string>)
)
