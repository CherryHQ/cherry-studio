import { describe, expect, it } from 'vitest'

import { selectCurrentMiniMaxModels } from '../minimaxModelDiscovery'

describe('MiniMax model discovery', () => {
  it('offers Flash before M3 and hides only known legacy text entries', () => {
    const ids = [
      'other-a',
      'minimax-m3',
      'minimax-m2-7',
      'other-b',
      'minimax-m3-1-flash',
      'minimax-01',
      'image-01',
      'minimax-h3',
      'custom-minimax'
    ]
    const models = ids.map((id) => ({ presetModelId: id, apiModelId: id }))
    const before = structuredClone(models)

    expect(selectCurrentMiniMaxModels(models).map((model) => model.apiModelId)).toEqual([
      'other-a',
      'minimax-m3-1-flash',
      'other-b',
      'minimax-m3',
      'image-01',
      'minimax-h3',
      'custom-minimax'
    ])
    expect(models).toEqual(before)
  })

  it('preserves exact provider routes, media and unrecognized custom IDs', () => {
    const models = [
      { apiModelId: 'minimax/minimax-m3', presetModelId: 'minimax-m3' },
      { apiModelId: 'minimax/minimax-m3.1-flash:free', presetModelId: 'minimax-m3-1-flash' },
      { apiModelId: 'speech-2.8-hd', presetModelId: null },
      { apiModelId: 'my-custom-model', presetModelId: null }
    ]
    const result = selectCurrentMiniMaxModels(models)
    expect(result).toEqual([models[1], models[0], models[2], models[3]])
    expect(result[0]).toBe(models[1])
  })

  it('does not invent a Flash route for an M3-only gateway', () => {
    const models = [{ apiModelId: 'MiniMaxAI/MiniMax-M3', presetModelId: 'minimax-m3' }]
    expect(selectCurrentMiniMaxModels(models)).toEqual(models)
  })
})
