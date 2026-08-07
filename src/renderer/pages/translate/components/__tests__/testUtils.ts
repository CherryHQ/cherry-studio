import { parsePersistedLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'

export const createLanguage = (langCode: string, value: string, emoji: string): TranslateLanguage => ({
  value,
  langCode: parsePersistedLangCode(langCode),
  emoji,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

export const english = createLanguage('en-us', 'English', '🇬🇧')
export const chinese = createLanguage('zh-cn', 'Chinese', '🇨🇳')
export const japanese = createLanguage('ja-jp', 'Japanese', '🇯🇵')
export const languagesFixture = [english, chinese, japanese]

export const createLanguagesHookResult = (languages: TranslateLanguage[] = languagesFixture) => ({
  languages,
  getLanguage: (code: string) => languages.find((language) => language.langCode === code),
  getLabel: (language: TranslateLanguage | TranslateLangCode | null, withEmoji = true) => {
    if (typeof language === 'string') return language === 'unknown' ? 'Unknown' : language
    if (!language) return 'Unknown'
    return withEmoji ? `${language.emoji} ${language.value}` : language.value
  }
})
