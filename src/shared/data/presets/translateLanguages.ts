/**
 * Builtin translate languages — pure data, no i18n or renderer dependencies.
 *
 * Used by:
 * - Main process seeding (insert into translate_language table on first run)
 * - Renderer process (identify builtin vs user-created languages)
 */

import { parsePersistedLangCode, type PersistedLangCode } from '../preference/preferenceTypes'

type BuiltinPersistedLangCode<T extends string> = PersistedLangCode & { readonly __builtinLangCode: T }

const parseBuiltinLangCode = <T extends string>(value: T): BuiltinPersistedLangCode<T> =>
  parsePersistedLangCode(value) as BuiltinPersistedLangCode<T>

/**
 * Enum-like constant object of all builtin translate languages.
 * Access individual languages via `BUILTIN_LANGUAGE.enUS`, `BUILTIN_LANGUAGE.zhCN`, etc.
 */
export const BUILTIN_LANGUAGE = {
  enUS: { langCode: parseBuiltinLangCode('en-us'), value: 'English', emoji: '🇺🇸' },
  zhCN: { langCode: parseBuiltinLangCode('zh-cn'), value: 'Chinese (Simplified)', emoji: '🇨🇳' },
  zhTW: { langCode: parseBuiltinLangCode('zh-tw'), value: 'Chinese (Traditional)', emoji: '🇭🇰' },
  jaJP: { langCode: parseBuiltinLangCode('ja-jp'), value: 'Japanese', emoji: '🇯🇵' },
  koKR: { langCode: parseBuiltinLangCode('ko-kr'), value: 'Korean', emoji: '🇰🇷' },
  frFR: { langCode: parseBuiltinLangCode('fr-fr'), value: 'French', emoji: '🇫🇷' },
  deDE: { langCode: parseBuiltinLangCode('de-de'), value: 'German', emoji: '🇩🇪' },
  itIT: { langCode: parseBuiltinLangCode('it-it'), value: 'Italian', emoji: '🇮🇹' },
  esES: { langCode: parseBuiltinLangCode('es-es'), value: 'Spanish', emoji: '🇪🇸' },
  ptPT: { langCode: parseBuiltinLangCode('pt-pt'), value: 'Portuguese', emoji: '🇵🇹' },
  ruRU: { langCode: parseBuiltinLangCode('ru-ru'), value: 'Russian', emoji: '🇷🇺' },
  plPL: { langCode: parseBuiltinLangCode('pl-pl'), value: 'Polish', emoji: '🇵🇱' },
  arSA: { langCode: parseBuiltinLangCode('ar-sa'), value: 'Arabic', emoji: '🇸🇦' },
  trTR: { langCode: parseBuiltinLangCode('tr-tr'), value: 'Turkish', emoji: '🇹🇷' },
  thTH: { langCode: parseBuiltinLangCode('th-th'), value: 'Thai', emoji: '🇹🇭' },
  viVN: { langCode: parseBuiltinLangCode('vi-vn'), value: 'Vietnamese', emoji: '🇻🇳' },
  idID: { langCode: parseBuiltinLangCode('id-id'), value: 'Indonesian', emoji: '🇮🇩' },
  urPK: { langCode: parseBuiltinLangCode('ur-pk'), value: 'Urdu', emoji: '🇵🇰' },
  msMY: { langCode: parseBuiltinLangCode('ms-my'), value: 'Malay', emoji: '🇲🇾' },
  ukUA: { langCode: parseBuiltinLangCode('uk-ua'), value: 'Ukrainian', emoji: '🇺🇦' }
} as const satisfies Record<string, { langCode: PersistedLangCode; value: string; emoji: string }>

type BuiltinLangCode<T> = T extends { readonly __builtinLangCode: infer Code extends string } ? Code : never
type BuiltinTranslateLangCode = BuiltinLangCode<(typeof BUILTIN_LANGUAGE)[keyof typeof BUILTIN_LANGUAGE]['langCode']>

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
  } satisfies Record<BuiltinTranslateLangCode | 'unknown', string>)
)
