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
        onEmojiClick(event.detail.unicode || event.detail.emoji.unicode)
      })
    }
  }, [onEmojiClick])

  // @ts-ignore next-line
  return <emoji-picker ref={ref} class={theme === 'dark' ? 'dark' : 'light'} style={{ border: 'none' }} />
}

export default EmojiPicker
