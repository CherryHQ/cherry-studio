import { describe, expect, it } from 'vitest'

import providerModels from '../../../../packages/provider-registry/data/provider-models.json'
import { normalizeAspectRatio } from '../aspectRatio'

describe('normalizeAspectRatio', () => {
  it.each([
    ['9:19.5', '9:19.5'],
    ['19.5:9', '19.5:9'],
    ['ASPECT_9_19.5', '9:19.5'],
    ['9_16', '9:16'],
    ['16:9', '16:9']
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeAspectRatio(value)).toBe(expected)
  })

  it('is idempotent', () => {
    expect(normalizeAspectRatio(normalizeAspectRatio('ASPECT_16_9'))).toBe('16:9')
  })

  it.each(['auto', '2K', '1024x1024', '9:', ':9', 'a:b', undefined])('rejects %s', (value) => {
    expect(normalizeAspectRatio(value)).toBeUndefined()
  })

  it('accepts every OpenRouter Seedream 4.5 catalog ratio except auto', () => {
    const model = providerModels.overrides.find(
      (entry) => entry.providerId === 'openrouter' && entry.modelId === 'seedream-4-5'
    )!
    const options = model.imageGeneration!.modes.generate!.supports.aspectRatio!.options

    expect(options).toContain('9:19.5')
    expect(options).toContain('19.5:9')
    expect(options).toContain('auto')
    for (const value of options) {
      if (value === 'auto') expect(normalizeAspectRatio(value)).toBeUndefined()
      else expect(normalizeAspectRatio(value), value).not.toBeUndefined()
    }
  })
})
