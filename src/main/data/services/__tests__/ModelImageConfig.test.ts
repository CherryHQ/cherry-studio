import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { ImageGenerationConfigSchema } from '@shared/ai/imageGenerationConfig'

import { openAIImageSupport } from '../../../../../packages/provider-registry/src/creators/imageCanvases'

const providerId = 'image-config-test'
const modelId = 'custom-image-alias'
const config = ImageGenerationConfigSchema.parse({
  preset: 'gpt-image-2-5-sunburst',
  generate: { defaults: { imageResolution: '2K', aspectRatio: '16:9', quality: 'max' } }
})

describe('model image configuration persistence', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    vi.spyOn(providerRegistryService, 'resolveModel').mockImplementation(
      (_, id) =>
        ({
          presetModel: [config.preset, 'doubao-seedream-5-0-pro'].includes(id)
            ? { id, imageGeneration: openAIImageSupport(true) }
            : null,
          registryOverride: null,
          reasoningProfile: { format: 'openai-chat', wire: { disabled: true } }
        }) as any
    )
    vi.spyOn(providerRegistryService, 'getImagePresetSupport').mockReturnValue(openAIImageSupport(true))
    dbh.db
      .insert(userProviderTable)
      .values({ providerId, name: 'Image config fixture', orderKey: 'a0', isEnabled: true })
      .run()
  })
  afterEach(() => vi.restoreAllMocks())
  it('persists a Seedream protocol choice without losing the model parameters', () => {
    const seedream = ImageGenerationConfigSchema.parse({
      preset: 'seedream',
      apiProtocol: 'openai',
      generate: { defaults: { imageResolution: '2K', aspectRatio: '16:9' }, options: {} }
    })
    modelService.create([
      { dto: { providerId, modelId, capabilities: ['image-generation'], imageGenerationConfig: seedream } }
    ])
    expect(modelService.getByKey(providerId, modelId).imageGenerationConfig).toEqual(seedream)
    modelService.update(providerId, modelId, { imageGenerationConfig: { ...seedream, apiProtocol: 'doubao' } })
    expect(modelService.getByKey(providerId, modelId).imageGenerationConfig).toEqual({
      ...seedream,
      apiProtocol: 'doubao'
    })
  })
  it('persists and resolves settings for a custom alias across independent reads', () => {
    modelService.create([
      { dto: { providerId, modelId, capabilities: ['image-generation'], imageGenerationConfig: config } }
    ])
    const row = dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, `${providerId}::${modelId}`))
      .get()!
    expect(row.imageGenerationConfig).toEqual(config)
    const loaded = modelService.getByKey(providerId, modelId)
    expect(loaded.imageGenerationConfig).toEqual(config)
    expect(loaded.imageGeneration?.modes.generate?.supports.quality).toMatchObject({ default: 'max' })
    expect(loaded.imageGeneration?.modes.edit?.supports.imageResolution).toMatchObject({ default: '2K' })
    modelService.update(providerId, modelId, { name: 'Renamed' })
    expect(modelService.getByKey(providerId, modelId).imageGenerationConfig).toEqual(config)
    modelService.update(providerId, modelId, { imageGenerationConfig: null })
    expect(modelService.getByKey(providerId, modelId).imageGenerationConfig).toBeUndefined()
  })
  it('serves saved model defaults while template queries remain unchanged', () => {
    modelService.create([{ dto: { providerId, modelId, imageGenerationConfig: config } }])
    expect(modelService.getImageGenerationSupport(providerId, modelId)?.modes.generate?.supports.quality).toMatchObject(
      { default: 'max' }
    )
    expect(
      modelService.getImageGenerationSupport(providerId, modelId, true)?.modes.generate?.supports.quality
    ).toMatchObject({ default: 'auto' })
  })
  it('rejects an invalid update without changing saved settings', () => {
    modelService.create([
      { dto: { providerId, modelId, capabilities: ['image-generation'], imageGenerationConfig: config } }
    ])
    expect(() =>
      modelService.update(providerId, modelId, {
        imageGenerationConfig: { ...config, generate: { defaults: { numImages: 0 }, options: {} } }
      })
    ).toThrow()
    expect(modelService.getByKey(providerId, modelId).imageGenerationConfig).toEqual(config)
  })
})
