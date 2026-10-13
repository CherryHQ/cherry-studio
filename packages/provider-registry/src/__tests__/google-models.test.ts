import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

const registry = createRegistry(bundledCatalog)

describe('Antigravity model contracts', () => {
  it.each(['antigravity-preview-09-2026', 'antigravity-preview-latest'])(
    'routes %s through Interactions while retaining its wire ID',
    (id) => {
      expect(registry.findModel(id)).toMatchObject({
        ownedBy: 'google',
        endpointTypes: ['google-interactions'],
        inputModalities: ['text', 'image']
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
