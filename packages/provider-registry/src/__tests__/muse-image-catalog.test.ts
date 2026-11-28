import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

describe('Muse Image catalog', () => {
  const registry = createRegistry(bundledCatalog)

  it.each(['meta/muse-image', 'muse-image-1.0'])('recognizes %s as a Meta image generator', (id) => {
    expect(registry.findModel(id)).toMatchObject({
      ownedBy: 'meta',
      capabilities: expect.arrayContaining(['image-generation']),
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    })
  })

  it('enables reference-image editing for the OpenRouter API model', () => {
    expect(registry.findOverride('openrouter', 'meta/muse-image')).toMatchObject({
      endpointTypes: ['openai-image-generation'],
      imageGeneration: { modes: { edit: { maxInputImages: 10 } } }
    })
  })
})
