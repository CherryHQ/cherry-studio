import { type CSSProperties, type HTMLAttributes, memo, type MouseEventHandler, useId, useMemo } from 'react'

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
export const DEFAULT_FLUENT_EMOJI = '😀' as const
const fluentEmojiData = fluentEmojiDataJson as unknown as FluentEmojiDataset
const codepointToIconName = fluentEmojiData.codepointToIconName
const fluentEmojiIcons = fluentEmojiData.icons
const EMOJI_PART_PATTERN = String.raw`(?:\p{Emoji}\uFE0F|\p{Emoji_Presentation})(?:\p{Emoji_Modifier})?`
const KEYCAP_EMOJI_PATTERN = String.raw`(?:[0-9#*]\uFE0F?\u20E3)`
const REGIONAL_FLAG_EMOJI_PATTERN = String.raw`(?:\p{Regional_Indicator}{2})`
const EMOJI_SEQUENCE_PATTERN = String.raw`(?:${EMOJI_PART_PATTERN}(?:\u200D${EMOJI_PART_PATTERN})*)`
const EMOJI_CLUSTER_PATTERN = String.raw`(?:${KEYCAP_EMOJI_PATTERN}|${REGIONAL_FLAG_EMOJI_PATTERN}|${EMOJI_SEQUENCE_PATTERN})`
const EMOJI_REGEX = new RegExp(`^(?:${EMOJI_CLUSTER_PATTERN})+$`, 'u')

function isEmoji(value: string): boolean {
  return EMOJI_REGEX.test(value)
}

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

export function getFluentEmojiOrFallback(
  emoji: string | null | undefined,
  fallbackEmoji: string = DEFAULT_FLUENT_EMOJI
): string {
  const normalizedEmoji = emoji?.trim() ?? ''
  if (!normalizedEmoji) return DEFAULT_FLUENT_EMOJI
  if (normalizedEmoji && hasFluentEmojiIcon(normalizedEmoji)) return normalizedEmoji
  if (!isEmoji(normalizedEmoji)) return normalizedEmoji
  if (fallbackEmoji !== DEFAULT_FLUENT_EMOJI && hasFluentEmojiIcon(fallbackEmoji)) return fallbackEmoji

  return DEFAULT_FLUENT_EMOJI
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

export interface EmojiIconProps {
  emoji: string
  className?: string
  fallbackEmoji?: string
  /** Fixed-mode side length in px. Ignored when `fluid` is true. */
  size?: number
  /** Foreground emoji font size in px. */
  fontSize?: number
  /** Fill the parent (h-full w-full) instead of using a fixed px size. Drops the default right margin. */
  fluid?: boolean
}

const EmojiIcon = ({
  emoji,
  className = '',
  fallbackEmoji,
  size = 26,
  fontSize = 15,
  fluid = false
}: EmojiIconProps) => {
  const displayEmoji = emoji ? getFluentEmojiOrFallback(emoji, fallbackEmoji) : ''
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
        <MemoizedEmojiGlyph emoji={displayEmoji || '⭐️'} decorative />
      </div>
      {displayEmoji ? <MemoizedEmojiGlyph emoji={displayEmoji} /> : null}
    </div>
  )
}

EmojiIcon.displayName = 'EmojiIcon'

export interface EmojiAvatarProps {
  children: string
  fallbackEmoji?: string
  size?: number
  fontSize?: number
  onClick?: MouseEventHandler<HTMLDivElement>
  className?: string
  style?: CSSProperties
}

const EmojiAvatar = ({ children, fallbackEmoji, size = 31, fontSize, onClick, className, style }: EmojiAvatarProps) => {
  const displayEmoji = getFluentEmojiOrFallback(children, fallbackEmoji)

  return (
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
      <MemoizedEmojiGlyph emoji={displayEmoji} />
    </div>
  )
}

EmojiAvatar.displayName = 'EmojiAvatar'

const MemoizedEmojiIcon = memo(EmojiIcon)
const MemoizedEmojiAvatar = memo(EmojiAvatar)

export { MemoizedEmojiAvatar as EmojiAvatar, MemoizedEmojiGlyph as EmojiGlyph, MemoizedEmojiIcon as EmojiIcon }
export default MemoizedEmojiGlyph
