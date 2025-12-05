import 'emoji-picker-element'

import TwemojiCountryFlagsWoff2 from '@renderer/assets/fonts/country-flag-fonts/TwemojiCountryFlags.woff2?url'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
// i18n translations from emoji-picker-element
import de from 'emoji-picker-element/i18n/de'
import en from 'emoji-picker-element/i18n/en'
import es from 'emoji-picker-element/i18n/es'
import fr from 'emoji-picker-element/i18n/fr'
import ja from 'emoji-picker-element/i18n/ja'
import pt_PT from 'emoji-picker-element/i18n/pt_PT'
import ru_RU from 'emoji-picker-element/i18n/ru_RU'
import zh_CN from 'emoji-picker-element/i18n/zh_CN'
import type Picker from 'emoji-picker-element/picker'
import type { EmojiClickEvent, NativeEmoji } from 'emoji-picker-element/shared'
// Emoji data from emoji-picker-element-data (local, no CDN)
// Using CLDR format for full multi-language search support (28 languages)
import dataDE from 'emoji-picker-element-data/de/cldr/data.json?url'
import dataEN from 'emoji-picker-element-data/en/cldr/data.json?url'
import dataES from 'emoji-picker-element-data/es/cldr/data.json?url'
import dataFR from 'emoji-picker-element-data/fr/cldr/data.json?url'
import dataJA from 'emoji-picker-element-data/ja/cldr/data.json?url'
import dataPT from 'emoji-picker-element-data/pt/cldr/data.json?url'
import dataRU from 'emoji-picker-element-data/ru/cldr/data.json?url'
import dataZH from 'emoji-picker-element-data/zh/cldr/data.json?url'
import dataZH_HANT from 'emoji-picker-element-data/zh-hant/cldr/data.json?url'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onEmojiClick: (emoji: string) => void
}

// Mapping from app locale to emoji-picker-element i18n
const i18nMap: Record<LanguageVarious, typeof en> = {
  'en-US': en,
  'zh-CN': zh_CN,
  'zh-TW': zh_CN, // Closest available
  'de-DE': de,
  'el-GR': en, // No Greek available, fallback to English
  'es-ES': es,
  'fr-FR': fr,
  'ja-JP': ja,
  'pt-PT': pt_PT,
  'ru-RU': ru_RU
}

// Mapping from app locale to emoji data URL
// Using CLDR format provides native language search support for all locales
const dataSourceMap: Record<LanguageVarious, string> = {
  'en-US': dataEN,
  'zh-CN': dataZH,
  'zh-TW': dataZH_HANT,
  'de-DE': dataDE,
  'el-GR': dataEN, // No Greek CLDR available, fallback to English
  'es-ES': dataES,
  'fr-FR': dataFR,
  'ja-JP': dataJA,
  'pt-PT': dataPT,
  'ru-RU': dataRU
}

// Mapping from app locale to emoji-picker-element locale string
// Must match the data source locale for proper IndexedDB caching
const localeMap: Record<LanguageVarious, string> = {
  'en-US': 'en',
  'zh-CN': 'zh',
  'zh-TW': 'zh-hant',
  'de-DE': 'de',
  'el-GR': 'en',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'ja-JP': 'ja',
  'pt-PT': 'pt',
  'ru-RU': 'ru'
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { theme } = useTheme()
  const { i18n } = useTranslation()
  const ref = useRef<Picker>(null)
  const currentLocale = i18n.language as LanguageVarious

  useEffect(() => {
    polyfillCountryFlagEmojis('Twemoji Mozilla', TwemojiCountryFlagsWoff2)
  }, [])

  // Configure picker with i18n and dataSource
  useEffect(() => {
    const picker = ref.current
    if (picker) {
      picker.i18n = i18nMap[currentLocale] || en
      picker.dataSource = dataSourceMap[currentLocale] || dataEN
      picker.locale = localeMap[currentLocale] || 'en'
    }
  }, [currentLocale])

  useEffect(() => {
    const picker = ref.current

    if (picker) {
      const handleEmojiClick = (event: EmojiClickEvent) => {
        event.stopPropagation()
        const { detail } = event
        // Use detail.unicode (processed with skin tone) or fallback to emoji's unicode for native emoji
        const unicode = detail.unicode || ('unicode' in detail.emoji ? (detail.emoji as NativeEmoji).unicode : '')
        onEmojiClick(unicode)
      }
      // 添加事件监听器
      picker.addEventListener('emoji-click', handleEmojiClick)

      // 清理事件监听器
      return () => {
        picker.removeEventListener('emoji-click', handleEmojiClick)
      }
    }
    return
  }, [onEmojiClick])

  // @ts-ignore next-line
  return <emoji-picker ref={ref} class={theme === 'dark' ? 'dark' : 'light'} style={{ border: 'none' }} />
}

export default EmojiPicker
