import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

describe('MAI Image catalog', () => {
  const registry = createRegistry(bundledCatalog)

  it.each(['microsoft/mai-image-2.7', 'microsoft/mai-image-2.7-flash'])(
    'recognizes %s as an image generation and editing model on OpenRouter',
    (apiModelId) => {
      expect(registry.findModel(apiModelId)).toMatchObject({
        ownedBy: 'microsoft',
        capabilities: expect.arrayContaining(['image-generation']),
        inputModalities: ['text', 'image'],
        outputModalities: ['image']
      })
      expect(registry.findOverride('openrouter', apiModelId)).toMatchObject({
        endpointTypes: ['openai-image-generation'],
        imageGeneration: { modes: { generate: expect.any(Object), edit: { maxInputImages: 5 } } }
      })
    }
  )
})
