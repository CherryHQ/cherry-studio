import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

describe('Inkling catalog', () => {
  const registry = createRegistry(bundledCatalog)

  it.each([
    ['thinkingmachines/Inkling', ['text', 'image', 'audio']],
    ['thinkingmachines/Inkling-Small', ['text', 'image', 'audio']],
    ['accounts/fireworks/models/inkling-2-mini', ['text', 'image']],
    ['thinkingmachines/Inkling-2-Small', ['text', 'image']]
  ])('resolves the developer and native inputs for %s', (modelId, inputModalities) => {
    expect(registry.findModel(modelId)).toMatchObject({
      ownedBy: 'thinkingmachines',
      contextWindow: 1048576,
      inputModalities,
      outputModalities: ['text'],
      capabilities: expect.arrayContaining(['reasoning', 'function-call', 'image-recognition'])
    })
  })
})
