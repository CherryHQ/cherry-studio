import TwemojiCountryFlagsWoff2 from '@renderer/assets/fonts/country-flag-fonts/TwemojiCountryFlags.woff2?url'
import { useTheme } from '@renderer/context/ThemeProvider'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import { FC, useEffect, useRef } from 'react'

interface Props {
  onEmojiClick: (emoji: string) => void
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { theme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    polyfillCountryFlagEmojis('Twemoji Mozilla', TwemojiCountryFlagsWoff2)
  }, [])

  useEffect(() => {
    const refValue = ref.current

    if (refValue) {
      const handleEmojiClick = (event: any) => {
        event.stopPropagation()
        onEmojiClick(event.detail.unicode || event.detail.emoji.unicode)
      }
      // 添加事件监听器
      refValue.addEventListener('emoji-click', handleEmojiClick)

      // 清理事件监听器
      return () => {
        refValue.removeEventListener('emoji-click', handleEmojiClick)
      }
    }
    return
  }, [onEmojiClick])

  // @ts-ignore next-line
  return <emoji-picker ref={ref} class={theme === 'dark' ? 'dark' : 'light'} style={{ border: 'none' }} />
}

export default EmojiPicker
