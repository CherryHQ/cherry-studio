import { describe, expect, it } from 'vitest'

import { createUniqueModelId, ModelSchema, parseUniqueModelId, UniqueModelIdSchema } from '../model'

describe('stored model ID parsing', () => {
  it.each([
    ['openai::gpt-4o', { providerId: 'openai', modelId: 'gpt-4o' }],
    ['::model', { providerId: '', modelId: 'model' }],
    ['provider::', { providerId: 'provider', modelId: '' }],
    ['provider::model::variant', { providerId: 'provider', modelId: 'model::variant' }]
  ] as const)('retains permissive first-separator parsing for %s', (storedId, expected) => {
    expect(parseUniqueModelId(storedId)).toEqual(expected)
  })

  it.each(['', 'unencoded-model'])('rejects a stored ID without the separator: %s', (storedId) => {
    expect(() => parseUniqueModelId(storedId)).toThrow(`Invalid UniqueModelId format: ${storedId}`)
  })
})

describe('runtime model parameter support', () => {
  it('accepts persisted sparse support metadata without changing its range or adding defaults', () => {
    const parameterSupport = { temperature: { supported: true, range: { min: 0, max: 1 } } }
    const model = ModelSchema.parse({
      id: 'custom::model',
      providerId: 'custom',
      name: 'Custom Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false,
      parameterSupport
    })

    expect(model.parameterSupport).toEqual(parameterSupport)
  })
})

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
