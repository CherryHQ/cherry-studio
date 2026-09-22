import { describe, expect, it } from 'vitest'

import { createUniqueModelId, UniqueModelIdSchema } from '../model'

describe('reserved route characters in a modelId', () => {
  // The schema and the constructor are the two ways a caller can ask whether an id
  // can carry a value, and they must agree: a consumer that guards with the first
  // must never hand the second a value it then rejects.
  const cases: [modelId: string, accepted: boolean][] = [
    ['a#b', false],
    ['c?d', false],
    ['sub/kept', true],
    ['gpt-4o', true]
  ]

  it.each(cases)('decides %s the same way in both', (modelId, accepted) => {
    const uniqueId = `comfyui::${modelId}`
    expect(UniqueModelIdSchema.safeParse(uniqueId).success).toBe(accepted)
    if (accepted) {
      expect(createUniqueModelId('comfyui', modelId)).toBe(uniqueId)
    } else {
      expect(() => createUniqueModelId('comfyui', modelId)).toThrow(/reserved route character/)
    }
  })
})
