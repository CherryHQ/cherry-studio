import { describe, expect, it } from 'vitest'

import { getValidPaintingOptions, resolvePaintingProvider } from '../providerSelection'

describe('providerSelection', () => {
  describe('getValidPaintingOptions', () => {
    it('filters ovms when it is not available', () => {
      expect(getValidPaintingOptions(['zhipu', 'ovms', 'cherryin'], false, 'not-running')).toEqual([
        'zhipu',
        'cherryin'
      ])
    })

    it('keeps ovms when it is running', () => {
      expect(getValidPaintingOptions(['zhipu', 'ovms'], true, 'running')).toEqual(['zhipu', 'ovms'])
    })
  })

  describe('resolvePaintingProvider', () => {
    it('prefers the requested provider when it is valid', () => {
      expect(resolvePaintingProvider('aihubmix', 'zhipu', ['zhipu', 'aihubmix'])).toBe('aihubmix')
    })

    it('falls back to the default provider when the requested provider is invalid', () => {
      expect(resolvePaintingProvider('missing', 'zhipu', ['zhipu', 'aihubmix'])).toBe('zhipu')
    })

    it('falls back to the first valid option when neither requested nor default is valid', () => {
      expect(resolvePaintingProvider('missing', 'also-missing', ['zhipu', 'aihubmix'])).toBe('zhipu')
    })
  })
})
