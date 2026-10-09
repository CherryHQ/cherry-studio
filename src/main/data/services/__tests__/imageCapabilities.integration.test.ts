import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { resolveImageCapability } from '@cherrystudio/provider-registry'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('image capability registry-to-database boundary', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    const originalGetPath = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      if (key === 'feature.provider_registry.data') {
        return fileURLToPath(new URL(`../../../../../packages/provider-registry/data/${filename}`, import.meta.url))
      }
      if (key === 'app.root') {
        return fileURLToPath(new URL(`../../../../../${filename}`, import.meta.url))
      }
      return originalGetPath(key, filename)
    })
    providerRegistryService.clearCache()
  })

  afterEach(() => {
    providerRegistryService.clearCache()
    vi.restoreAllMocks()
  })

  it.each([
    ['aihubmix', 'qwen-image', 'qwen-image'],
    ['aihubmix', 'irag-1.0', 'irag-1-0'],
    ['openai', 'gpt-image-1', 'gpt-image-1'],
    ['tokenhub', 'hy-image-v3', 'hy-image-v3-0']
  ])(
    'shares %s/%s capability facts through a custom provider instance',
    (presetProviderId, apiModelId, presetModelId) => {
      const providerId = 'b4fa6b35-8a0d-4160-b899-51f070ddc307'
      dbh.db
        .insert(userProviderTable)
        .values({ providerId, presetProviderId, name: 'My image connection', orderKey: 'a0' })
        .run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: createUniqueModelId(providerId, apiModelId),
          providerId,
          modelId: apiModelId,
          presetModelId,
          name: 'My image model',
          orderKey: 'a0'
        })
        .run()

      const model = modelService.getByKey(providerId, apiModelId)
      const support = providerRegistryService.getImageGenerationSupport(providerId, apiModelId)
      expect(support).not.toBeNull()
      expect(model.imageGeneration).toEqual(support)
      const resolution = resolveImageCapability(model.imageGeneration, 'generate', false)
      expect(resolution.kind).toBe('supported')
      if (resolution.kind !== 'supported') throw new Error('Catalog fixture has no generation capability')
      expect(resolution.capability.inputs.images.min).toBe(0)
      if (presetProviderId === 'aihubmix') {
        expect(resolution.capability.supports).toHaveProperty('addWatermark')
        expect(resolution.capability.supports).not.toHaveProperty('negativePrompt')
      }
      if (presetProviderId === 'tokenhub') {
        // https://cloud.tencent.com/document/product/1823/135745; retrieved 2026-09-09.
        expect(resolution.capability.inputs.images.max).toEqual({ kind: 'known', value: 3 })
      }
    }
  )

  it('does not infer image capability for an unknown custom model', () => {
    const providerId = 'custom-tokenhub'
    dbh.db
      .insert(userProviderTable)
      .values({ providerId, presetProviderId: 'tokenhub', name: 'TokenHub', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId(providerId, 'unregistered-image'),
        providerId,
        modelId: 'unregistered-image',
        name: 'Unregistered',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()

    expect(providerRegistryService.getImageGenerationSupport(providerId, 'unregistered-image')).toBeNull()
    const model = modelService.getByKey(providerId, 'unregistered-image')
    expect(resolveImageCapability(model.imageGeneration, 'generate', false)).toEqual({ kind: 'unconfigured' })
  })
})
