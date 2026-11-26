// Protects the WaveSpeed Seedream 5.5 image modes against seeding a ratio into edit requests.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('WaveSpeed Seedream 5.5 image modes', () => {
  const modes = loader.findOverride('wavespeed', 'doubao-seedream-5-5')?.imageGeneration?.modes

  it('declares generate and edit with their endpoints', () => {
    expect(modes?.generate?.vendorTransport).toEqual({ endpoint: '/api/v3/bytedance/seedream-v5.5' })
    expect(modes?.edit?.vendorTransport).toEqual({ endpoint: '/api/v3/bytedance/seedream-v5.5/edit' })
    expect(modes?.edit?.maxInputImages).toBe(10)
  })

  // A default would be seeded into the draft on model selection and then sent to edit when a
  // reference is added, overriding the ratio the API derives from the input. The API itself
  // defaults generate to 1:1, so neither mode declares one.
  it.each(['generate', 'edit'] as const)('declares no aspect ratio default in %s', (mode) => {
    const aspectRatio = modes?.[mode]?.supports?.aspectRatio
    expect(aspectRatio).toBeDefined()
    expect(aspectRatio).not.toHaveProperty('default')
  })
})
