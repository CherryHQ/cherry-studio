import { describe, expect, it } from 'vitest'

import { normalizeImageSize, normalizePixelSize } from '../imageSize'

describe('normalizePixelSize', () => {
  it.each([
    ['1536×1024', '1536x1024'],
    ['1536*1024', '1536x1024'],
    ['1536X1024', '1536x1024'],
    ['1536x1024', '1536x1024'],
    [' 1536 × 1024 ', '1536x1024']
  ])('canonicalizes %j to %j', (raw, expected) => {
    expect(normalizePixelSize(raw)).toBe(expected)
  })

  it.each(['auto', '1K', '0x1024', '1024x0', 'invalid', '', undefined])(
    'returns undefined for non-pixel or invalid dimension %j',
    (raw) => {
      expect(normalizePixelSize(raw)).toBeUndefined()
    }
  )
})

describe('normalizeImageSize', () => {
  it.each([
    ['1536×1024', '1536x1024'],
    ['1536*1024', '1536x1024'],
    [' 1536 × 1024 ', '1536x1024'],
    ['auto', 'auto'],
    [' auto ', 'auto'],
    ['1K', '1K']
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeImageSize(raw)).toBe(expected)
  })

  it.each(['   ', '', undefined])('drops blank input %j', (raw) => {
    expect(normalizeImageSize(raw)).toBeUndefined()
  })
})
