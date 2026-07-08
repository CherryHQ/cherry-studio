// Original path: src/renderer/components/EmojiIcon.tsx
import { cn } from '@cherrystudio/ui/lib/utils'
import type { CSSProperties, FC } from 'react'

import EmojiGlyph from './emoji-glyph'

interface EmojiIconProps {
  emoji: string
  className?: string
  /** Fixed-mode side length in px. Ignored when `fluid` is true. */
  size?: number
  /** Foreground emoji font size in px. */
  fontSize?: number
  /** Fill the parent (h-full w-full) instead of using a fixed px size. Drops the default right margin. */
  fluid?: boolean
}

const EmojiIcon: FC<EmojiIconProps> = ({ emoji, className = '', size = 26, fontSize = 15, fluid = false }) => {
  const wrapperStyle: CSSProperties = fluid
    ? { fontSize: `${fontSize}px` }
    : {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${size / 2}px`,
        fontSize: `${fontSize}px`
      }

  return (
    <div
      className={cn(
        'relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full',
        fluid ? 'h-full w-full' : 'mr-1',
        className
      )}
      style={wrapperStyle}>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center blur-sm opacity-40"
        style={{
          fontSize: '200%',
          transform: 'scale(1.5)'
        }}>
        <EmojiGlyph emoji={emoji || '⭐️'} decorative />
      </div>
      {emoji ? <EmojiGlyph emoji={emoji} /> : null}
    </div>
  )
}

export default EmojiIcon
