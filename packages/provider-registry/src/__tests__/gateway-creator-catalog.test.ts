import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

describe('Vercel AI Gateway creator catalog', () => {
  const registry = createRegistry(bundledCatalog)

  it.each([
    ['recursive/flint-v1.0', 'recursive', ['reasoning', 'function-call', 'structured-output']],
    ['reflection/beam', 'reflection', ['reasoning', 'function-call']],
    ['sakana/fugu-max', 'sakana', ['reasoning', 'image-recognition', 'function-call']],
    ['sakana/fugu-ultra', 'sakana', ['reasoning', 'image-recognition', 'function-call']],
    ['sakana/fugu-ultra-v2', 'sakana', ['reasoning', 'image-recognition', 'function-call']],
    ['sakana/namazu', 'sakana', ['reasoning', 'image-recognition', 'file-input']],
    ['scaledown/scaledown-extract-1', 'scaledown', ['structured-output']],
    ['scaledown/scaledown-summarize-1', 'scaledown', []]
  ])('resolves %s to its creator and exact Gateway offer', (apiModelId, ownedBy, capabilities) => {
    const offer = registry.findOverride('gateway', apiModelId)
    expect(offer?.apiModelId).toBe(apiModelId)

    expect(registry.findModel(offer?.modelId ?? apiModelId)).toMatchObject({
      ownedBy,
      outputModalities: ['text'],
      ...(capabilities.length && { capabilities: expect.arrayContaining(capabilities) })
    })
  })
})
