/**
 * Adjust a UTF-16 slice boundary so it never falls between the two halves of a
 * surrogate pair. `slice(0, index)` with the returned value keeps astral
 * characters (emoji, extended CJK) whole instead of emitting a lone surrogate,
 * which chat APIs reject or render as a replacement character.
 *
 * Use this when the length budget is a hard limit measured in UTF-16 code units
 * (e.g. a platform message cap or a stored-field byte budget): it clamps an
 * arbitrary boundary in place without shifting the budget to code points. For a
 * one-shot display truncation where the cap is soft, a code-point view such as
 * `[...text].slice(0, max).join('')` reads cleaner and is just as correct.
 */
export function clampSurrogateBoundary(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index
  const high = text.charCodeAt(index - 1)
  const low = text.charCodeAt(index)
  // A high surrogate at index-1 paired with a low surrogate at index means the
  // boundary cuts a code point in half; step back so the pair stays together.
  if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
    return index - 1
  }
  return index
}
