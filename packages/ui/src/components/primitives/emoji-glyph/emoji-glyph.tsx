import { getFluentEmojiIcon, scopeFluentEmojiSvgBody } from '@cherrystudio/ui/fluent-emoji'
import { cn } from '@cherrystudio/ui/lib/utils'
import { type HTMLAttributes, memo, useId, useMemo } from 'react'

export interface EmojiGlyphProps extends HTMLAttributes<HTMLSpanElement> {
  emoji: string
  decorative?: boolean
}

const EmojiGlyph = ({ emoji, decorative = false, className, ...props }: EmojiGlyphProps) => {
  const icon = getFluentEmojiIcon(emoji)
  const rawId = useId()
  const scopedBody = useMemo(() => (icon ? scopeFluentEmojiSvgBody(icon.body, rawId) : null), [icon, rawId])

  if (!icon || !scopedBody) {
    return (
      <span
        className={cn('inline-flex items-center justify-center leading-none', className)}
        {...props}
        aria-hidden={decorative ? true : props['aria-hidden']}>
        {emoji}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex items-center justify-center leading-none', className)} {...props}>
      <svg
        aria-hidden="true"
        className="h-[1em] w-[1em] shrink-0"
        data-fluent-emoji={emoji}
        focusable="false"
        viewBox={`0 0 ${icon.width} ${icon.height}`}
        dangerouslySetInnerHTML={{ __html: scopedBody }}
      />
      {decorative ? null : <span className="sr-only">{emoji}</span>}
    </span>
  )
}

EmojiGlyph.displayName = 'EmojiGlyph'

const MemoizedEmojiGlyph = memo(EmojiGlyph)

export { MemoizedEmojiGlyph as EmojiGlyph }
export default MemoizedEmojiGlyph
