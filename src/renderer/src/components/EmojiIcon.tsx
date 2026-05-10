import { cn } from '@cherrystudio/ui/lib/utils'
import type { CSSProperties, FC } from 'react'

interface EmojiIconProps {
  emoji: string
  className?: string
  size?: number
  fontSize?: number
}

const EmojiIcon: FC<EmojiIconProps> = ({ emoji, className, size = 26, fontSize = 15 }) => {
  const containerStyle: CSSProperties = {
    width: size,
    height: size,
    fontSize
  }

  return (
    <div
      className={cn(
        'relative mr-[3px] flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        className
      )}
      style={containerStyle}>
      <div className="absolute inset-0 flex h-full w-full scale-150 items-center justify-center text-[200%] opacity-40 blur-[5px]">
        {emoji || '⭐️'}
      </div>
      {emoji}
    </div>
  )
}

export default EmojiIcon
