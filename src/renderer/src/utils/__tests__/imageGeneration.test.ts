import { describe, expect, it } from 'vitest'

import { extractAspectRatioFromPrompt, normalizeImageDimension } from '../imageGeneration'

describe('imageGeneration helpers', () => {
  it('extracts a supported aspect ratio from prompt text', () => {
    expect(extractAspectRatioFromPrompt('Generate a 16:9 cosmic planet image')).toBe('16:9')
  })

  it('ignores ratios in non-image prompts', () => {
    expect(extractAspectRatioFromPrompt('The ratio is 7:5 for the cost breakdown')).toBeUndefined()
  })

  it('normalizes ratio-like image sizes to aspectRatio', () => {
    expect(normalizeImageDimension('16:9')).toEqual({ aspectRatio: '16:9' })
  })

  it('preserves any normalized ratio string', () => {
    expect(normalizeImageDimension('21:9')).toEqual({ aspectRatio: '21:9' })
  })

  it('keeps pixel sizes as size values', () => {
    expect(normalizeImageDimension('1024x1024')).toEqual({ size: '1024x1024' })
  })
})
