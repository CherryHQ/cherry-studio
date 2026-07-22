import { describe, expect, it } from 'vitest'

import { anthropicImageTokens, geminiImageTokens, ollamaImageTokens, openaiImageTokens } from '../imageTokens'

describe('anthropicImageTokens', () => {
  it('is ceil(w·h / 750) for a small image', () => {
    expect(anthropicImageTokens({ width: 300, height: 300 })).toBe(Math.ceil((300 * 300) / 750))
  })
  it('clamps a huge image to the ≤1568px / ≤1.15 MP budget (≈ 1590 ceiling)', () => {
    expect(anthropicImageTokens({ width: 8000, height: 8000 })).toBeLessThanOrEqual(1600)
  })
  it('falls back to the constant with no dims', () => {
    expect(anthropicImageTokens()).toBe(1590)
  })
})

describe('openaiImageTokens', () => {
  it('is 765 for a 1024² image (→768², 4 tiles: 85 + 170·4)', () => {
    expect(openaiImageTokens({ width: 1024, height: 1024 })).toBe(765)
  })
  it('is 85 + 170 for a tiny single-tile image', () => {
    expect(openaiImageTokens({ width: 100, height: 100 })).toBe(85 + 170)
  })
  it('falls back to the constant with no dims', () => {
    expect(openaiImageTokens()).toBe(765)
  })
})

describe('geminiImageTokens', () => {
  it('is a flat 258 when both sides ≤ 384px', () => {
    expect(geminiImageTokens({ width: 384, height: 200 })).toBe(258)
  })
  it('tiles larger images (258 per crop)', () => {
    expect(geminiImageTokens({ width: 960, height: 540 })).toBeGreaterThan(258)
  })
  it('falls back to the constant with no dims', () => {
    expect(geminiImageTokens()).toBe(258)
  })
})

describe('ollamaImageTokens', () => {
  it('is a flat constant regardless of dims', () => {
    expect(ollamaImageTokens()).toBe(1000)
    expect(ollamaImageTokens({ width: 4000, height: 4000 })).toBe(1000)
  })
})
