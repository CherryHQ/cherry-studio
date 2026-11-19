/** `Tab.icon` descriptor prefix marking an emoji glyph (vs mini-app id / image url). */
export const TAB_ICON_EMOJI_PREFIX = 'emoji:'

/** Build a `Tab.icon` value for an assistant/agent emoji, or undefined when blank. */
export function emojiTabIcon(emoji: string | null | undefined): string | undefined {
  const glyph = emoji?.trim()
  return glyph ? `${TAB_ICON_EMOJI_PREFIX}${glyph}` : undefined
}

/** CLI artwork rendered with the same circular avatar as the agent directory. */
export const TAB_ICON_CLI_PREFIX = 'cli:'

export function cliTabIcon(id: string): string {
  return `${TAB_ICON_CLI_PREFIX}${id}`
}
