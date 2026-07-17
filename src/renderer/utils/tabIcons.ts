import type { EntityAvatar } from '@shared/data/types/entityAvatar'

/** `Tab.icon` descriptor prefix marking an emoji glyph (vs mini-app id / image url). */
export const TAB_ICON_EMOJI_PREFIX = 'emoji:'

/** Build a `Tab.icon` value for an assistant/agent emoji, or undefined when blank. */
export function emojiTabIcon(emoji: string | null | undefined): string | undefined {
  const glyph = emoji?.trim()
  return glyph ? `${TAB_ICON_EMOJI_PREFIX}${glyph}` : undefined
}

/** Convert the strict entity-avatar contract to the tab system's persisted icon descriptor. */
export function entityAvatarTabIcon(avatar: EntityAvatar | undefined): string | undefined {
  return avatar?.kind === 'emoji' ? emojiTabIcon(avatar.emoji) : avatar?.src
}
