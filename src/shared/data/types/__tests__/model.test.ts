import { describe, expect, it } from 'vitest'

import { createUniqueModelId, hasReservedRouteChar, UniqueModelIdSchema } from '../model'

describe('hasReservedRouteChar', () => {
  it('flags the route characters a modelId cannot carry', () => {
    expect(hasReservedRouteChar('a#b')).toBe(true)
    expect(hasReservedRouteChar('c?d')).toBe(true)
    expect(hasReservedRouteChar('sub/kept')).toBe(false)
    expect(hasReservedRouteChar('gpt-4o')).toBe(false)
  })

  // The schema and the constructor must agree: a consumer that guards with the
  // first must never hand the second a value it then rejects.
  it('agrees with the schema and the constructor', () => {
    for (const modelId of ['a#b', 'c?d', 'sub/kept']) {
      const uniqueId = `comfyui::${modelId}`
      expect(UniqueModelIdSchema.safeParse(uniqueId).success).toBe(!hasReservedRouteChar(modelId))
      if (hasReservedRouteChar(modelId)) {
        expect(() => createUniqueModelId('comfyui', modelId)).toThrow(/reserved route character/)
      } else {
        expect(createUniqueModelId('comfyui', modelId)).toBe(uniqueId)
      }
    }
  })
})
