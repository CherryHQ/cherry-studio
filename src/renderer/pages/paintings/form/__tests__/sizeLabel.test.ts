import { describe, expect, it } from 'vitest'

import { deriveChipLabel } from '../sizeLabel'

describe('deriveChipLabel', () => {
  it('displays the selected canonical ratio without reducing or rounding it', () => {
    expect(deriveChipLabel('Portrait', '10:16')).toBe('10:16')
    expect(deriveChipLabel('Landscape', '1.5:1')).toBe('1.5:1')
  })

  it('pixel-size value → "W×H" (no extra ratio line)', () => {
    expect(deriveChipLabel('1024x1024', '1024x1024')).toBe('1024×1024')
    expect(deriveChipLabel('1536x1024', '1536x1024')).toBe('1536×1024')
    expect(deriveChipLabel('1024×1536', '1024x1536')).toBe('1024×1536')
  })

  it('label of the form "head (W×H)" prefers the head', () => {
    // jimeng-style label from dmxapi era: "1:1 (1328×1328)" → just "1:1".
    expect(deriveChipLabel('1:1 (1328×1328)', '1328x1328')).toBe('1:1')
    expect(deriveChipLabel('16:9 (2560×1440)', '2560x1440')).toBe('16:9')
  })

  it('non-parseable value falls back to the label verbatim', () => {
    // i18n'd label for the 'auto' sentinel.
    expect(deriveChipLabel('自动', 'auto')).toBe('自动')
    expect(deriveChipLabel('Auto', 'auto')).toBe('Auto')
    // gemini-3-pro-image-preview's imageResolution chips.
    expect(deriveChipLabel('1K', '1K')).toBe('1K')
    expect(deriveChipLabel('2K', '2K')).toBe('2K')
    expect(deriveChipLabel('4K', '4K')).toBe('4K')
  })
})
