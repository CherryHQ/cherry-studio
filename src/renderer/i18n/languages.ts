import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'

export const appLanguageOptions: ReadonlyArray<{
  value: LanguageVarious
  label: string
  flag: string
}> = [
  { value: 'zh-CN', label: '中文', flag: '🇨🇳' },
  { value: 'zh-TW', label: '中文（繁体）', flag: '🇭🇰' },
  { value: 'en-US', label: 'English', flag: '🇺🇸' },
  { value: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { value: 'ru-RU', label: 'Русский', flag: '🇷🇺' },
  { value: 'el-GR', label: 'Ελληνικά', flag: '🇬🇷' },
  { value: 'es-ES', label: 'Español', flag: '🇪🇸' },
  { value: 'fr-FR', label: 'Français', flag: '🇫🇷' },
  { value: 'pt-PT', label: 'Português', flag: '🇵🇹' },
  { value: 'ro-RO', label: 'Română', flag: '🇷🇴' },
  { value: 'vi-VN', label: 'Tiếng Việt', flag: '🇻🇳' }
]

export function isAppLanguage(value: string | null | undefined): value is LanguageVarious {
  return appLanguageOptions.some((option) => option.value === value)
}
