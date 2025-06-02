import i18n from '@renderer/i18n'

export interface TranslateLanguageOption {
  value: string
  langCode?: string
  label: string
  emoji: string
}

export const TranslateLanguageOptions: TranslateLanguageOption[] = [
  {
    value: 'english',
    langCode: 'en-us',
    label: i18n.t('languages.english'),
    emoji: '🇬🇧'
  },
  {
    value: 'chinese',
    langCode: 'zh-cn',
    label: i18n.t('languages.chinese'),
    emoji: '🇨🇳'
  },
  {
    value: 'chinese-traditional',
    langCode: 'zh-tw',
    label: i18n.t('languages.chinese-traditional'),
    emoji: '🇭🇰'
  },
  {
    value: 'japanese',
    langCode: 'ja-jp',
    label: i18n.t('languages.japanese'),
    emoji: '🇯🇵'
  },
  {
    value: 'korean',
    langCode: 'ko-kr',
    label: i18n.t('languages.korean'),
    emoji: '🇰🇷'
  },
  {
    value: 'russian',
    langCode: 'ru-ru',
    label: i18n.t('languages.russian'),
    emoji: '🇷🇺'
  },
  {
    value: 'spanish',
    langCode: 'es-es',
    label: i18n.t('languages.spanish'),
    emoji: '🇪🇸'
  },
  {
    value: 'french',
    langCode: 'fr-fr',
    label: i18n.t('languages.french'),
    emoji: '🇫🇷'
  },
  {
    value: 'italian',
    langCode: 'it-it',
    label: i18n.t('languages.italian'),
    emoji: '🇮🇹'
  },
  {
    value: 'portuguese',
    langCode: 'pt-pt',
    label: i18n.t('languages.portuguese'),
    emoji: '🇵🇹'
  },
  {
    value: 'arabic',
    langCode: 'ar-ar',
    label: i18n.t('languages.arabic'),
    emoji: '🇸🇦'
  },
  {
    value: 'german',
    langCode: 'de-de',
    label: i18n.t('languages.german'),
    emoji: '🇩🇪'
  }
]

export const translateLanguageOptions = (): typeof TranslateLanguageOptions => {
  return TranslateLanguageOptions.map((option) => {
    return {
      value: option.value,
      label: i18n.t(`languages.${option.value}`),
      emoji: option.emoji
    }
  })
}
