import type { CSSProperties, FC } from 'react'

import { cn } from '../../lib/utils'

interface EmojiIconProps {
  emoji: string
  className?: string
  /** Fixed-mode side length in px. Ignored when `fluid` is true. */
  size?: number
  /** @deprecated Emoji artwork now scales with `size`. */
  fontSize?: number
  /** Fill the parent (h-full w-full) instead of using a fixed px size. */
  fluid?: boolean
}

const EmojiIcon: FC<EmojiIconProps> = ({ emoji, className, size = 26, fontSize, fluid = false }) => {
  const wrapperStyle: CSSProperties = fluid
    ? { containerType: 'inline-size' }
    : {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${size / 2}px`,
        containerType: 'inline-size'
      }
  const foregroundFontSize = fontSize === undefined ? '70cqi' : `${fontSize}px`
  const backgroundFontSize = fontSize === undefined ? '120cqi' : `${fontSize * 2}px`

  return (
    <div
      data-slot="emoji-icon"
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        fluid && 'h-full w-full',
        className
      )}
      style={wrapperStyle}>
      <span
        data-slot="emoji-icon-background"
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center blur-sm opacity-40"
        style={{
          fontSize: backgroundFontSize,
          lineHeight: 1,
          transform: 'scale(1.5)'
        }}>
        {emoji || '⭐️'}
      </span>
      <span
        data-slot="emoji-icon-foreground"
        className="relative flex items-center justify-center"
        style={{ fontSize: foregroundFontSize, lineHeight: 1 }}>
        {emoji}
      </span>
    </div>
  )
}

export default EmojiIcon
