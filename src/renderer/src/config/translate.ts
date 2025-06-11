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
  },
  {
    value: 'bulgarian',
    langCode: 'bg-bg',
    label: i18n.t('languages.bulgarian'),
    emoji: '🇧🇬'
  },
  {
    value: 'romanian',
    langCode: 'ro-ro',
    label: i18n.t('languages.romanian'),
    emoji: '🇷🇴'
  },
  {
    value: 'danish',
    langCode: 'da-dk',
    label: i18n.t('languages.danish'),
    emoji: '🇩🇰'
  },
  {
    value: 'swedish',
    langCode: 'sv-se',
    label: i18n.t('languages.swedish'),
    emoji: '🇸🇪'
  },
  {
    value: 'norwegian',
    langCode: 'nb-no',
    label: i18n.t('languages.norwegian'),
    emoji: '🇳🇴'
  },
  {
    value: 'finnish',
    langCode: 'fi-fi',
    label: i18n.t('languages.finnish'),
    emoji: '🇫🇮'
  },
  {
    value: 'czech',
    langCode: 'cs-cz',
    label: i18n.t('languages.czech'),
    emoji: '🇨🇿'
  },
  {
    value: 'slovak',
    langCode: 'sk-sk',
    label: i18n.t('languages.slovak'),
    emoji: '🇸🇰'
  },
  {
    value: 'hungarian',
    langCode: 'hu-hu',
    label: i18n.t('languages.hungarian'),
    emoji: '🇭🇺'
  },
  {
    value: 'greek',
    langCode: 'el-gr',
    label: i18n.t('languages.greek'),
    emoji: '🇬🇷'
  },
  {
    value: 'ukrainian',
    langCode: 'uk-ua',
    label: i18n.t('languages.ukrainian'),
    emoji: '🇺🇦'
  },
  {
    value: 'croatian',
    langCode: 'hr-hr',
    label: i18n.t('languages.croatian'),
    emoji: '🇭🇷'
  },
  {
    value: 'serbian',
    langCode: 'sr-rs',
    label: i18n.t('languages.serbian'),
    emoji: '🇷🇸'
  },
  {
    value: 'slovenian',
    langCode: 'sl-si',
    label: i18n.t('languages.slovenian'),
    emoji: '🇸🇮'
  },
  {
    value: 'estonian',
    langCode: 'et-ee',
    label: i18n.t('languages.estonian'),
    emoji: '🇪🇪'
  },
  {
    value: 'latvian',
    langCode: 'lv-lv',
    label: i18n.t('languages.latvian'),
    emoji: '🇱🇻'
  },
  {
    value: 'lithuanian',
    langCode: 'lt-lt',
    label: i18n.t('languages.lithuanian'),
    emoji: '🇱🇹'
  },
  {
    value: 'dutch',
    langCode: 'nl-nl',
    label: i18n.t('languages.dutch'),
    emoji: '🇳🇱'
  },
  {
    value: 'belarusian',
    langCode: 'be-by',
    label: i18n.t('languages.belarusian'),
    emoji: '🇧🇾'
  },
  {
    value: 'georgian',
    langCode: 'ka-ge',
    label: i18n.t('languages.georgian'),
    emoji: '🇬🇪'
  },
  {
    value: 'macedonian',
    langCode: 'mk-mk',
    label: i18n.t('languages.macedonian'),
    emoji: '🇲🇰'
  },
  {
    value: 'albanian',
    langCode: 'sq-al',
    label: i18n.t('languages.albanian'),
    emoji: '🇦🇱'
  },
  {
    value: 'armenian',
    langCode: 'hy-am',
    label: i18n.t('languages.armenian'),
    emoji: '🇦🇲'
  }
].sort((a, b) => a.value.localeCompare(b.value));

export const translateLanguageOptions = (): typeof TranslateLanguageOptions => {
  return TranslateLanguageOptions.map((option) => {
    return {
      value: option.value,
      label: i18n.t(`languages.${option.value}`),
      emoji: option.emoji
    }
  })
}
