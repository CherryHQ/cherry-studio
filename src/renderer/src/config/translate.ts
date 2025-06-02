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
    value: 'french',
    langCode: 'fr-fr',
    label: i18n.t('languages.french'),
    emoji: '🇫🇷'
  },
  {
    value: 'german',
    langCode: 'de-de',
    label: i18n.t('languages.german'),
    emoji: '🇩🇪'
  },
  {
    value: 'italian',
    langCode: 'it-it',
    label: i18n.t('languages.italian'),
    emoji: '🇮🇹'
  },
  {
    value: 'spanish',
    langCode: 'es-es',
    label: i18n.t('languages.spanish'),
    emoji: '🇪🇸'
  },
  {
    value: 'portuguese',
    langCode: 'pt-pt',
    label: i18n.t('languages.portuguese'),
    emoji: '🇵🇹'
  },
  {
    value: 'russian',
    langCode: 'ru-ru',
    label: i18n.t('languages.russian'),
    emoji: '🇷🇺'
  },
  {
    value: 'polish',
    langCode: 'pl-pl',
    label: i18n.t('languages.polish'),
    emoji: '🇵🇱'
  },
  {
    value: 'arabic',
    langCode: 'ar-ar',
    label: i18n.t('languages.arabic'),
    emoji: '🇸🇦'
  },
  {
    value: 'turkish',
    langCode: 'tr-tr',
    label: i18n.t('languages.turkish'),
    emoji: '🇹🇷'
  },
  {
    value: 'thai',
    langCode: 'th-th',
    label: i18n.t('languages.thai'),
    emoji: '🇹🇭'
  },
  {
    value: 'vietnamese',
    langCode: 'vi-vn',
    label: i18n.t('languages.vietnamese'),
    emoji: '🇻🇳'
  },
  {
    value: 'indonesian',
    langCode: 'id-id',
    label: i18n.t('languages.indonesian'),
    emoji: '🇮🇩'
  },
  {
    value: 'urdu',
    langCode: 'ur-pk',
    label: i18n.t('languages.urdu'),
    emoji: '🇵🇰'
  },
  {
    value: 'malay',
    langCode: 'ms-my',
    label: i18n.t('languages.malay'),
    emoji: '🇲🇾'
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
