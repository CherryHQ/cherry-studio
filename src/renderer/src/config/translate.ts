import i18n from '@renderer/i18n'

export interface TranslateLanguageOption {
  value: string
  langCode?: string
  label: string
  emoji: string
}

export const TranslateLanguageOptions: TranslateLanguageOption[] = [
  {
    value: 'English',
    langCode: 'en-us',
    label: i18n.t('languages.english'),
    emoji: '🇬🇧'
  },
  {
    value: 'Chinese (Simplified)',
    langCode: 'zh-cn',
    label: i18n.t('languages.chinese'),
    emoji: '🇨🇳'
  },
  {
    value: 'Chinese (Traditional)',
    langCode: 'zh-tw',
    label: i18n.t('languages.chinese-traditional'),
    emoji: '🇭🇰'
  },
  {
    value: 'Japanese',
    langCode: 'ja-jp',
    label: i18n.t('languages.japanese'),
    emoji: '🇯🇵'
  },
  {
    value: 'Korean',
    langCode: 'ko-kr',
    label: i18n.t('languages.korean'),
    emoji: '🇰🇷'
  },

  {
    value: 'French',
    langCode: 'fr-fr',
    label: i18n.t('languages.french'),
    emoji: '🇫🇷'
  },
  {
    value: 'German',
    langCode: 'de-de',
    label: i18n.t('languages.german'),
    emoji: '🇩🇪'
  },
  {
    value: 'Italian',
    langCode: 'it-it',
    label: i18n.t('languages.italian'),
    emoji: '🇮🇹'
  },
  {
    value: 'Spanish',
    langCode: 'es-es',
    label: i18n.t('languages.spanish'),
    emoji: '🇪🇸'
  },
  {
    value: 'Portuguese',
    langCode: 'pt-pt',
    label: i18n.t('languages.portuguese'),
    emoji: '🇵🇹'
  },
  {
    value: 'Russian',
    langCode: 'ru-ru',
    label: i18n.t('languages.russian'),
    emoji: '🇷🇺'
  },
  {
    value: 'Polish',
    langCode: 'pl-pl',
    label: i18n.t('languages.polish'),
    emoji: '🇵🇱'
  },
  {
    value: 'Arabic',
    langCode: 'ar-ar',
    label: i18n.t('languages.arabic'),
    emoji: '🇸🇦'
  },
  {
    value: 'Turkish',
    langCode: 'tr-tr',
    label: i18n.t('languages.turkish'),
    emoji: '🇹🇷'
  },
  {
    value: 'Thai',
    langCode: 'th-th',
    label: i18n.t('languages.thai'),
    emoji: '🇹🇭'
  },
  {
    value: 'Vietnamese',
    langCode: 'vi-vn',
    label: i18n.t('languages.vietnamese'),
    emoji: '🇻🇳'
  },
  {
    value: 'Indonesian',
    langCode: 'id-id',
    label: i18n.t('languages.indonesian'),
    emoji: '🇮🇩'
  },
  {
    value: 'Urdu',
    langCode: 'ur-pk',
    label: i18n.t('languages.urdu'),
    emoji: '🇵🇰'
  },
  {
    value: 'Malay',
    langCode: 'ms-my',
    label: i18n.t('languages.malay'),
    emoji: '🇲🇾'
  }
]

export const translateLanguageOptions = (): typeof TranslateLanguageOptions => {
  return TranslateLanguageOptions.map((option) => {
    return {
      value: option.value,
      label: option.label,
      emoji: option.emoji
    }
  })
}
