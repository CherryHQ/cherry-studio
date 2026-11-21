const SIZE = 32
const GLYPH_SCALE = 3
const GLYPH_GAP = 1
const MAX_DISPLAY_COUNT = 9

/** 3x5 pixel glyphs; each row is a 3-bit mask. */
const GLYPHS: Record<string, readonly number[]> = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b001, 0b001, 0b001],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  '+': [0b000, 0b010, 0b111, 0b010, 0b000]
}

const FILL = 0x1f
const RING = 0xff

export function formatBadgeLabel(count: number): string {
  return count > MAX_DISPLAY_COUNT ? `${MAX_DISPLAY_COUNT}+` : String(count)
}

/**
 * Premultiplied BGRA bitmap (32x32, meant for scaleFactor 2) of a dark circle with a light ring
 * and the count in white, so it stays legible on both light and dark taskbars.
 */
export function renderTaskbarBadgeBitmap(count: number): { buffer: Buffer; width: number; height: number } {
  const label = formatBadgeLabel(count)
  const labelWidth = (label.length * 3 + (label.length - 1) * GLYPH_GAP) * GLYPH_SCALE
  const left = Math.round((SIZE - labelWidth) / 2)
  const top = Math.round((SIZE - 5 * GLYPH_SCALE) / 2)
  const buffer = Buffer.alloc(SIZE * SIZE * 4)

  const isGlyphPixel = (x: number, y: number): boolean => {
    const col = Math.floor((x - left) / GLYPH_SCALE)
    const row = Math.floor((y - top) / GLYPH_SCALE)
    if (x < left || row < 0 || row > 4) return false
    const charIndex = Math.floor(col / (3 + GLYPH_GAP))
    const glyphCol = col - charIndex * (3 + GLYPH_GAP)
    if (charIndex >= label.length || glyphCol > 2) return false
    return ((GLYPHS[label[charIndex]][row] >> (2 - glyphCol)) & 1) === 1
  }

  const center = SIZE / 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      const alpha = Math.min(1, Math.max(0, center - distance))
      if (alpha === 0) continue
      const ringMix = Math.min(1, Math.max(0, distance - (center - 2.5)))
      const channel = isGlyphPixel(x, y) ? RING : Math.round(FILL + (RING - FILL) * ringMix)
      const value = Math.round(channel * alpha)
      const offset = (y * SIZE + x) * 4
      buffer[offset] = value
      buffer[offset + 1] = value
      buffer[offset + 2] = value
      buffer[offset + 3] = Math.round(alpha * 255)
    }
  }

  return { buffer, width: SIZE, height: SIZE }
}
