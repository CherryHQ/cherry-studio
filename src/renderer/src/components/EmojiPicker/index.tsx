import 'emoji-picker-element'

import TwemojiCountryFlagsWoff2 from '@renderer/assets/fonts/country-flag-fonts/TwemojiCountryFlags.woff2?url'
import { useTheme } from '@renderer/context/ThemeProvider'
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
// Note: Only en, fr, ja, ru, zh have emojibase format available
import dataEN from 'emoji-picker-element-data/en/emojibase/data.json?url'
import dataFR from 'emoji-picker-element-data/fr/emojibase/data.json?url'
import dataJA from 'emoji-picker-element-data/ja/emojibase/data.json?url'
import dataRU from 'emoji-picker-element-data/ru/emojibase/data.json?url'
import dataZH from 'emoji-picker-element-data/zh/emojibase/data.json?url'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onEmojiClick: (emoji: string) => void
}

// Mapping from app locale to emoji-picker-element i18n
const i18nMap: Record<string, typeof en> = {
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
// Note: Only en, fr, ja, ru, zh have emojibase format; others fallback to English
const dataSourceMap: Record<string, string> = {
  'en-US': dataEN,
  'zh-CN': dataZH,
  'zh-TW': dataZH, // Fallback to simplified Chinese
  'de-DE': dataEN, // No German emojibase available
  'el-GR': dataEN, // No Greek available
  'es-ES': dataEN, // No Spanish emojibase available
  'fr-FR': dataFR,
  'ja-JP': dataJA,
  'pt-PT': dataEN, // No Portuguese emojibase available
  'ru-RU': dataRU
}

// Mapping from app locale to emoji-picker-element locale string
// Must match the data source locale for proper IndexedDB caching
const localeMap: Record<string, string> = {
  'en-US': 'en',
  'zh-CN': 'zh',
  'zh-TW': 'zh',
  'de-DE': 'en',
  'el-GR': 'en',
  'es-ES': 'en',
  'fr-FR': 'fr',
  'ja-JP': 'ja',
  'pt-PT': 'en',
  'ru-RU': 'ru'
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { theme } = useTheme()
  const { i18n } = useTranslation()
  const ref = useRef<Picker>(null)
  const currentLocale = i18n.language

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
