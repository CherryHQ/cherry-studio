import { describe, expect, it, vi } from 'vitest'

import type { BulkUpdateModelsDto } from '@shared/data/api/schemas/models'
import { MODELS_BULK_UPDATE_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { persistProviderModels } from '../providerModelSetup'

function makeModel(index: number): Model {
  return {
    id: `openai::model-${index}`,
    providerId: 'openai',
    apiModelId: `model-${index}`,
    name: `Model ${index}`,
    capabilities: [],
    isEnabled: false,
    isHidden: true,
    supportsStreaming: true
  }
}

describe('persistProviderModels', () => {
  it('restores existing models within the bulk-update transport limit', async () => {
    const models = Array.from({ length: MODELS_BULK_UPDATE_MAX_ITEMS + 1 }, (_, index) => makeModel(index))
    const updateModels = vi.fn(async (items: BulkUpdateModelsDto) =>
      items.map(({ uniqueModelId }) => ({
        ...models.find((model) => model.id === uniqueModelId)!,
        isEnabled: true,
        isHidden: false
      }))
    )

    const persisted = await persistProviderModels({
      provider: { id: 'openai' } as Provider,
      selectedModels: models,
      localModels: models,
      createModels: vi.fn(async () => []),
      updateModels
    })

    expect(updateModels).toHaveBeenCalledTimes(2)
    expect(updateModels.mock.calls.map(([items]) => items.length)).toEqual([MODELS_BULK_UPDATE_MAX_ITEMS, 1])
    expect(persisted).toHaveLength(models.length)
    expect(persisted.every((model) => model.isEnabled && !model.isHidden)).toBe(true)
  })

  describe('live DotHoosh metadata for duplicated providers', () => {
    const DUPLICATE_ID = '6f1c2a9e-3b7d-4c58-9a10-2d4e8b5f7c31'
    const pricing = {
      input: { perMillionTokens: 3, currency: 'USD' },
      output: { perMillionTokens: 15, currency: 'USD' }
    }
    const presetBackedModel = {
      id: `${DUPLICATE_ID}::claude-sonnet-5`,
      providerId: DUPLICATE_ID,
      apiModelId: 'claude-sonnet-5',
      presetModelId: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false,
      maxOutputTokens: 64_000,
      pricing
    } as unknown as Model

    async function persist(provider: Partial<Provider>) {
      const createModels = vi.fn(async (items: any[]) => items.map(() => presetBackedModel))
      await persistProviderModels({
        provider: { id: DUPLICATE_ID, ...provider } as Provider,
        selectedModels: [presetBackedModel],
        localModels: [],
        createModels,
        updateModels: vi.fn(async () => [])
      })
      return createModels.mock.calls[0][0][0]
    }

    it('keeps listed limits and prices for a duplicate of the DotHoosh preset', async () => {
      const dto = await persist({ presetProviderId: 'dothoosh' })

      expect(dto).toMatchObject({ maxOutputTokens: 64_000, pricing })
    })

    it.each([{ presetProviderId: 'openrouter' }, {}])('drops listed limits and prices for %j', async (provider) => {
      const dto = await persist(provider)

      expect(dto).not.toHaveProperty('pricing')
      expect(dto).not.toHaveProperty('maxOutputTokens')
    })
  })
})
