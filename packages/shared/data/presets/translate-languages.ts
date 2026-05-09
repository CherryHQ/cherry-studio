/**
 * Builtin translate languages — pure data, no i18n or renderer dependencies.
 *
 * Used by:
 * - Main process seeding (insert into translate_language table on first run)
 * - Renderer process (identify builtin vs user-created languages)
 */

import { parsePersistedLangCode, type PersistedLangCode } from '../preference/preferenceTypes'

/**
 * Enum-like constant object of all builtin translate languages.
 * Access individual languages via `BUILTIN_LANGUAGE.enUS`, `BUILTIN_LANGUAGE.zhCN`, etc.
 */
export const BUILTIN_LANGUAGE = {
  enUS: { langCode: parsePersistedLangCode('en-us'), value: 'English', emoji: '🇺🇸' },
  zhCN: { langCode: parsePersistedLangCode('zh-cn'), value: 'Chinese (Simplified)', emoji: '🇨🇳' },
  zhTW: { langCode: parsePersistedLangCode('zh-tw'), value: 'Chinese (Traditional)', emoji: '🇭🇰' },
  jaJP: { langCode: parsePersistedLangCode('ja-jp'), value: 'Japanese', emoji: '🇯🇵' },
  koKR: { langCode: parsePersistedLangCode('ko-kr'), value: 'Korean', emoji: '🇰🇷' },
  frFR: { langCode: parsePersistedLangCode('fr-fr'), value: 'French', emoji: '🇫🇷' },
  deDE: { langCode: parsePersistedLangCode('de-de'), value: 'German', emoji: '🇩🇪' },
  itIT: { langCode: parsePersistedLangCode('it-it'), value: 'Italian', emoji: '🇮🇹' },
  esES: { langCode: parsePersistedLangCode('es-es'), value: 'Spanish', emoji: '🇪🇸' },
  ptPT: { langCode: parsePersistedLangCode('pt-pt'), value: 'Portuguese', emoji: '🇵🇹' },
  ruRU: { langCode: parsePersistedLangCode('ru-ru'), value: 'Russian', emoji: '🇷🇺' },
  plPL: { langCode: parsePersistedLangCode('pl-pl'), value: 'Polish', emoji: '🇵🇱' },
  arSA: { langCode: parsePersistedLangCode('ar-sa'), value: 'Arabic', emoji: '🇸🇦' },
  trTR: { langCode: parsePersistedLangCode('tr-tr'), value: 'Turkish', emoji: '🇹🇷' },
  thTH: { langCode: parsePersistedLangCode('th-th'), value: 'Thai', emoji: '🇹🇭' },
  viVN: { langCode: parsePersistedLangCode('vi-vn'), value: 'Vietnamese', emoji: '🇻🇳' },
  idID: { langCode: parsePersistedLangCode('id-id'), value: 'Indonesian', emoji: '🇮🇩' },
  urPK: { langCode: parsePersistedLangCode('ur-pk'), value: 'Urdu', emoji: '🇵🇰' },
  msMY: { langCode: parsePersistedLangCode('ms-my'), value: 'Malay', emoji: '🇲🇾' },
  ukUA: { langCode: parsePersistedLangCode('uk-ua'), value: 'Ukrainian', emoji: '🇺🇦' }
} as const satisfies Record<string, { langCode: PersistedLangCode; value: string; emoji: string }>

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
  } satisfies Record<string, string>)
)
