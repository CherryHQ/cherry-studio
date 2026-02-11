// Original path: src/renderer/src/components/EmojiIcon.tsx
import type { FC } from 'react'

interface EmojiIconProps {
  emoji: string
  className?: string
  size?: number
  fontSize?: number
}

const EmojiIcon: FC<EmojiIconProps> = ({ emoji, className = '', size = 26, fontSize = 15 }) => {
  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 relative overflow-hidden mr-1 rounded-full ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${size / 2}px`,
        fontSize: `${fontSize}px`
      }}>
      <div
        className="absolute inset-0 flex items-center justify-center blur-sm opacity-40"
        style={{
          fontSize: '200%',
          transform: 'scale(1.5)'
        }}>
        {emoji || '⭐️'}
      </div>
      {emoji}
    </div>
  )
}

export default EmojiIcon
