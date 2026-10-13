import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

const registry = createRegistry(bundledCatalog)

describe('Gemini Omni model contracts', () => {
  it.each(['gemini-omni-1.1-flash', 'gemini-omni-flash-preview'])(
    'routes %s through Interactions while retaining its wire ID',
    (id) => {
      expect(registry.findModel(id)).toMatchObject({
        ownedBy: 'google',
        endpointTypes: ['google-interactions'],
        inputModalities: ['text', 'image', 'video'],
        outputModalities: ['video'],
        capabilities: expect.arrayContaining(['video-generation'])
      })
      expect(registry.findOverride('gemini', id)).toMatchObject({
        apiModelId: id,
        endpointTypes: ['google-interactions']
      })
      expect(registry.findProvider('gemini')?.endpointConfigs?.['google-interactions']).toMatchObject({
        adapterFamily: 'google-interactions'
      })
    }
  )
})
