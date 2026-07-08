import fluentEmojiDataJson from './fluent-emoji-data.json'

export interface FluentEmojiIconData {
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

export function emojiToFluentEmojiIconName(emoji: string): string | null {
  for (const key of toCodepointKeys(emoji)) {
    const iconName = codepointToIconName[key]
    if (iconName && fluentEmojiIcons[iconName]) return iconName
  }

  return null
}

export function getFluentEmojiIcon(emoji: string): FluentEmojiIconData | null {
  const iconName = emojiToFluentEmojiIconName(emoji)
  return iconName ? fluentEmojiIcons[iconName] : null
}

export function hasFluentEmojiIcon(emoji: string): boolean {
  return getFluentEmojiIcon(emoji) !== null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function scopeFluentEmojiSvgBody(body: string, scopeId: string): string {
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
