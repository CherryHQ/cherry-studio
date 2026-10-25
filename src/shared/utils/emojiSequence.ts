/**
 * One complete emoji sequence: regional-indicator flags, keycaps, ZWJ
 * sequences, skin tones, variation selectors and tag sequences.
 *
 * Speech playback and the custom-rule validator share this single source, so a
 * rule the agent can save is always a sequence the converter can resolve.
 */
const EMOJI_SEQUENCE =
  '(?:\\p{Regional_Indicator}{2}|[0-9#*]\\uFE0F?\\u20E3|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)(?:\\uFE0F|\\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)|\\p{Emoji_Modifier}|[\\u{E0020}-\\u{E007F}]+)*'

/** Anchored: the whole string must be one complete sequence. */
export const COMPLETE_EMOJI_SEQUENCE = new RegExp(`^(?:${EMOJI_SEQUENCE})$`, 'u')

/** Global form for rewriting every sequence inside prose. */
export const EMOJI_SEQUENCE_GLOBAL = new RegExp(EMOJI_SEQUENCE, 'gu')
