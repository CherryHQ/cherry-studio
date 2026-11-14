const SINGLE_EMOJI = /^\p{RGI_Emoji}$/v
// Country/subdivision flags, 🏳/🏴-based flags (🏳️‍🌈, 🏴‍☠️), and a bare skin-tone swatch.
const EXCLUDED_EMOJI =
  /^(?:\p{RGI_Emoji_Flag_Sequence}|\p{RGI_Emoji_Tag_Sequence}|[\u{1F3F3}\u{1F3F4}]|\p{Emoji_Modifier}$)/v

/** The value as an avatar emoji, or `undefined` when it is not a single non-flag emoji. */
export function toAvatarEmoji(value: string | undefined): string | undefined {
  const emoji = value?.trim()
  if (!emoji || !SINGLE_EMOJI.test(emoji) || EXCLUDED_EMOJI.test(emoji)) return undefined
  return emoji
}
