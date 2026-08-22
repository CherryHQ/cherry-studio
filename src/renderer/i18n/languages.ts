import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { languageNativeNameMap } from '@shared/utils/languages'

/** Display order of the app's language picker. Labels come from the shared native-name map. */
const APP_LANGUAGE_FLAGS: ReadonlyArray<{ value: LanguageVarious; flag: string }> = [
  { value: 'zh-CN', flag: '🇨🇳' },
  { value: 'zh-TW', flag: '🇭🇰' },
  { value: 'en-US', flag: '🇺🇸' },
  { value: 'de-DE', flag: '🇩🇪' },
  { value: 'ja-JP', flag: '🇯🇵' },
  { value: 'ru-RU', flag: '🇷🇺' },
  { value: 'el-GR', flag: '🇬🇷' },
  { value: 'es-ES', flag: '🇪🇸' },
  { value: 'fr-FR', flag: '🇫🇷' },
  { value: 'pt-PT', flag: '🇵🇹' },
  { value: 'ro-RO', flag: '🇷🇴' },
  { value: 'th-TH', flag: '🇹🇭' },
  { value: 'vi-VN', flag: '🇻🇳' }
]

export const appLanguageOptions: ReadonlyArray<{
  value: LanguageVarious
  label: string
  flag: string
}> = APP_LANGUAGE_FLAGS.map(({ value, flag }) => ({ value, flag, label: languageNativeNameMap[value] }))

export function isAppLanguage(value: string | null | undefined): value is LanguageVarious {
  return appLanguageOptions.some((option) => option.value === value)
}
