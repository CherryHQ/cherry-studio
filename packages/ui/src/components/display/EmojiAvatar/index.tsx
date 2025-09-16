// Original path: src/renderer/src/components/Avatar/EmojiAvatar.tsx
import { memo } from 'react'

interface EmojiAvatarProps {
  children: string
  size?: number
  fontSize?: number
  onClick?: React.MouseEventHandler<HTMLDivElement>
  className?: string
  style?: React.CSSProperties
  ref?: React.RefObject<HTMLDivElement>
}

const EmojiAvatar = ({ children, size = 31, fontSize, onClick, className = '', style, ref }: EmojiAvatarProps) => {
  const computedFontSize = fontSize ?? size * 0.5

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`flex items-center justify-center rounded-[20%] border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 cursor-pointer transition-opacity hover:opacity-80 ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${computedFontSize}px`,
        ...style
      }}>
      {children}
    </div>
  )
}

EmojiAvatar.displayName = 'EmojiAvatar'

export default memo(EmojiAvatar)
