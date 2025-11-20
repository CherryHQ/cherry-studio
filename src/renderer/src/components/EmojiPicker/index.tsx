import 'emoji-picker-element'

import TwemojiCountryFlagsWoff2 from '@renderer/assets/fonts/country-flag-fonts/TwemojiCountryFlags.woff2?url'
import { useTheme } from '@renderer/context/ThemeProvider'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import emojiData from 'emoji-picker-element-data/en/emojibase/data.json'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'

interface EmojiPickerElement extends HTMLElement {
  dataSource: typeof emojiData
}

interface EmojiClickEvent extends CustomEvent {
  detail: {
    unicode?: string
    emoji?: { unicode: string }
  }
}

interface Props {
  onEmojiClick: (emoji: string) => void
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'emoji-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { class?: string }, HTMLElement>
    }
  }
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { theme } = useTheme()
  const ref = useRef<EmojiPickerElement>(null)

  useEffect(() => {
    polyfillCountryFlagEmojis('Twemoji Mozilla', TwemojiCountryFlagsWoff2)
  }, [])

  // 初始化 dataSource
  useEffect(() => {
    if (ref.current) {
      ref.current.dataSource = emojiData
    }
  }, [])

  // 事件监听
  useEffect(() => {
    const refValue = ref.current

    if (refValue) {
      const handleEmojiClick = (event: Event) => {
        event.stopPropagation()
        const emojiEvent = event as EmojiClickEvent
        onEmojiClick(emojiEvent.detail.unicode || emojiEvent.detail.emoji?.unicode || '')
      }
      refValue.addEventListener('emoji-click', handleEmojiClick)

      return () => {
        refValue.removeEventListener('emoji-click', handleEmojiClick)
      }
    }
    return
  }, [onEmojiClick])

  return <emoji-picker ref={ref} class={theme === 'dark' ? 'dark' : 'light'} style={{ border: 'none' }} />
}

export default EmojiPicker
