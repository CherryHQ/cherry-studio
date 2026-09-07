import type { BulkUpdateModelsDto } from '@shared/data/api/schemas/models'
import { MODELS_BULK_UPDATE_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

import { persistProviderModels } from '../providerModelSetup'

function makeModel(index: number): Model {
  return {
    id: `openai::model-${index}` as UniqueModelId,
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
})
