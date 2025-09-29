import { cn } from '@heroui/react'
import React, { memo } from 'react'

interface EmojiAvatarProps {
  children: string
  size?: number
  fontSize?: number
  onClick?: React.MouseEventHandler<HTMLDivElement>
  className?: string
  style?: React.CSSProperties
}

const EmojiAvatar = ({ children, size = 31, fontSize, onClick, className, style }: EmojiAvatarProps) => (
  <div
    onClick={onClick}
    className={cn(
      'flex items-center justify-center',
      'bg-background-soft border-border',
      'rounded-[20%] cursor-pointer',
      'transition-opacity hover:opacity-80',
      'border-[0.5px]',
      className
    )}
    style={{
      width: size,
      height: size,
      fontSize: fontSize ?? size * 0.5,
      ...style
    }}>
    {children}
  </div>
)

EmojiAvatar.displayName = 'EmojiAvatar'

export default memo(EmojiAvatar)
