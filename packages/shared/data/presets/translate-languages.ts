/**
 * Builtin translate languages — pure data, no i18n or renderer dependencies.
 *
 * Used by:
 * - Main process seeding (insert into translate_language table on first run)
 * - Renderer process (identify builtin vs user-created languages)
 */

export const BUILTIN_TRANSLATE_LANGUAGES = [
  { langCode: 'en-us', value: 'English', emoji: '🇺🇸' },
  { langCode: 'zh-cn', value: 'Chinese (Simplified)', emoji: '🇨🇳' },
  { langCode: 'zh-tw', value: 'Chinese (Traditional)', emoji: '🇭🇰' },
  { langCode: 'ja-jp', value: 'Japanese', emoji: '🇯🇵' },
  { langCode: 'ko-kr', value: 'Korean', emoji: '🇰🇷' },
  { langCode: 'fr-fr', value: 'French', emoji: '🇫🇷' },
  { langCode: 'de-de', value: 'German', emoji: '🇩🇪' },
  { langCode: 'it-it', value: 'Italian', emoji: '🇮🇹' },
  { langCode: 'es-es', value: 'Spanish', emoji: '🇪🇸' },
  { langCode: 'pt-pt', value: 'Portuguese', emoji: '🇵🇹' },
  { langCode: 'ru-ru', value: 'Russian', emoji: '🇷🇺' },
  { langCode: 'pl-pl', value: 'Polish', emoji: '🇵🇱' },
  { langCode: 'ar-sa', value: 'Arabic', emoji: '🇸🇦' },
  { langCode: 'tr-tr', value: 'Turkish', emoji: '🇹🇷' },
  { langCode: 'th-th', value: 'Thai', emoji: '🇹🇭' },
  { langCode: 'vi-vn', value: 'Vietnamese', emoji: '🇻🇳' },
  { langCode: 'id-id', value: 'Indonesian', emoji: '🇮🇩' },
  { langCode: 'ur-pk', value: 'Urdu', emoji: '🇵🇰' },
  { langCode: 'ms-my', value: 'Malay', emoji: '🇲🇾' },
  { langCode: 'uk-ua', value: 'Ukrainian', emoji: '🇺🇦' }
] as const satisfies ReadonlyArray<{ langCode: string; value: string; emoji: string }>

export type BuiltinLangCode = (typeof BUILTIN_TRANSLATE_LANGUAGES)[number]['langCode']
