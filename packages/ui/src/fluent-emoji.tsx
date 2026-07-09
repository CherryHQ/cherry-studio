import { type HTMLAttributes, memo, useId, useMemo } from 'react'

import fluentEmojiDataJson from './fluent-emoji-data.json'
import { cn } from './lib/utils'

interface FluentEmojiIconData {
  body: string
  width: number
  height: number
}

interface FluentEmojiDataset {
  codepointToIconName: Record<string, string>
  icons: Record<string, FluentEmojiIconData>
}

const VARIATION_SELECTOR_16 = 'fe0f'
const fluentEmojiData = fluentEmojiDataJson as unknown as FluentEmojiDataset
const codepointToIconName = fluentEmojiData.codepointToIconName
const fluentEmojiIcons = fluentEmojiData.icons

function toCodepointKeys(emoji: string): string[] {
  const codepoints = Array.from(emoji.trim()).map((char) => char.codePointAt(0)?.toString(16) ?? '')
  if (codepoints.length === 0) return []

  const exact = codepoints.join('-')
  const withoutEmojiPresentation = codepoints.filter((codepoint) => codepoint !== VARIATION_SELECTOR_16).join('-')

  return exact === withoutEmojiPresentation ? [exact] : [exact, withoutEmojiPresentation]
}

function emojiToFluentEmojiIconName(emoji: string): string | null {
  for (const key of toCodepointKeys(emoji)) {
    const iconName = codepointToIconName[key]
    if (iconName && fluentEmojiIcons[iconName]) return iconName
  }

  return null
}

function getFluentEmojiIcon(emoji: string): FluentEmojiIconData | null {
  const iconName = emojiToFluentEmojiIconName(emoji)
  return iconName ? fluentEmojiIcons[iconName] : null
}

export function hasFluentEmojiIcon(emoji: string): boolean {
  return getFluentEmojiIcon(emoji) !== null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scopeFluentEmojiSvgBody(body: string, scopeId: string): string {
  const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  if (ids.length === 0) return body

  const safeScopeId = scopeId.replace(/[^a-zA-Z0-9_-]/g, '-')
  let scopedBody = body

  for (const id of ids) {
    const escapedId = escapeRegExp(id)
    const scopedId = `${safeScopeId}-${id}`
    scopedBody = scopedBody
      .replace(new RegExp(`\\bid="${escapedId}"`, 'g'), `id="${scopedId}"`)
      .replace(new RegExp(`url\\(#${escapedId}\\)`, 'g'), `url(#${scopedId})`)
      .replace(new RegExp(`\\bhref="#${escapedId}"`, 'g'), `href="#${scopedId}"`)
      .replace(new RegExp(`\\bxlink:href="#${escapedId}"`, 'g'), `xlink:href="#${scopedId}"`)
  }

  return scopedBody
}

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
