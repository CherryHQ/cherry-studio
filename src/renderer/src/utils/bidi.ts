export type BidiDir = 'ltr' | 'rtl' | 'auto'

const isRtlCodePoint = (codePoint: number) => {
  // Hebrew, Arabic, Syriac, Arabic supplement/extended and presentation forms.
  return (
    (codePoint >= 0x0590 && codePoint <= 0x08ff) ||
    (codePoint >= 0xfb1d && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfefc)
  )
}

/**
 * Best-effort direction detection for mixed RTL/LTR user-generated content.
 *
 * Important: this is intentionally biased toward RTL when any RTL characters
 * are present. This matches the practical expectation for Persian/Arabic text
 * embedded in an otherwise LTR UI.
 */
export const detectBidiDirFromText = (text: string): BidiDir => {
  if (!text) return 'auto'

  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i) ?? 0
    // Skip the surrogate pair second code unit
    if (codePoint > 0xffff) i++

    if (isRtlCodePoint(codePoint)) return 'rtl'
  }

  return text.trim().length > 0 ? 'ltr' : 'auto'
}
