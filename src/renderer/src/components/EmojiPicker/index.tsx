import { useTheme } from '@renderer/context/ThemeProvider'
import { FC, useEffect, useRef } from 'react'

interface Props {
  onEmojiClick: (emoji: string) => void
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { theme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.addEventListener('emoji-click', (event: any) => {
        event.stopPropagation()
        // 确保只使用单个emoji字符
        const emojiUnicode = event.detail.emoji.unicode
        if (emojiUnicode) {
          // 提取第一个emoji字符
          const firstEmoji = [...emojiUnicode][0]
          console.log('选择的原始emoji:', emojiUnicode, '提取后:', firstEmoji)
          onEmojiClick(firstEmoji)
        } else {
          onEmojiClick(emojiUnicode)
        }
      })
    }
  }, [onEmojiClick])

  // @ts-ignore next-line
  return <emoji-picker ref={ref} class={theme === 'dark' ? 'dark' : 'light'} style={{ border: 'none' }} />
}

export default EmojiPicker
