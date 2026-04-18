import type { BatchCreateModelInput } from '@data/services/ModelService'
import { CreateModelsBatchDtoSchema, MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../tests/__mocks__/MainLoggerService'

const { lookupModelMock, batchCreateMock, createMock } = vi.hoisted(() => ({
  lookupModelMock: vi.fn(),
  batchCreateMock: vi.fn(),
  createMock: vi.fn()
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    lookupModel: lookupModelMock
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    batchCreate: batchCreateMock,
    create: createMock
  }
}))

import { modelHandlers } from '../models'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Model handler validation', () => {
  it('accepts batch create payloads up to the configured limit', () => {
    const items = Array.from({ length: MODELS_BATCH_MAX_ITEMS }, (_, index) => ({
      providerId: 'openai',
      modelId: `gpt-${index}`
    }))

    expect(() => CreateModelsBatchDtoSchema.parse({ items })).not.toThrow()
  })

  it('rejects batch create payloads over the configured limit', () => {
    const items = Array.from({ length: MODELS_BATCH_MAX_ITEMS + 1 }, (_, index) => ({
      providerId: 'openai',
      modelId: `gpt-${index}`
    }))

    expect(() => CreateModelsBatchDtoSchema.parse({ items })).toThrow()
  })
})

describe('/models/batch handler', () => {
  it('falls back to custom model creation when registry lookup fails for one item', async () => {
    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})
    const registryData = { presetModel: { id: 'gpt-4o', name: 'GPT-4o' }, registryOverride: null }

    lookupModelMock.mockResolvedValueOnce(registryData).mockRejectedValueOnce(new Error('lookup failed'))
    batchCreateMock.mockResolvedValue([])

    await modelHandlers['/models/batch'].POST({
      body: {
        items: [
          { providerId: 'openai', modelId: 'gpt-4o' },
          { providerId: 'custom/provider', modelId: 'my-model' }
        ]
      }
    } as any)

    expect(batchCreateMock).toHaveBeenCalledWith([
      {
        dto: { providerId: 'openai', modelId: 'gpt-4o' },
        registryData
      },
      {
        dto: { providerId: 'custom/provider', modelId: 'my-model' },
        registryData: undefined
      }
    ] satisfies BatchCreateModelInput[])
    expect(warnSpy).toHaveBeenCalledWith(
      'Registry lookup failed during batch create, falling back to custom',
      expect.objectContaining({ providerId: 'custom/provider', modelId: 'my-model' })
    )
  })
})

describe('/models POST handler', () => {
  it('passes registry data to modelService.create', async () => {
    const registryData = {
      presetModel: { id: 'gpt-4o', name: 'GPT-4o' },
      registryOverride: null,
      defaultChatEndpoint: 'openai',
      reasoningFormatTypes: {}
    }
    lookupModelMock.mockResolvedValue(registryData)
    createMock.mockResolvedValue({ id: 'openai::gpt-4o' })

    await modelHandlers['/models'].POST({
      body: { providerId: 'openai', modelId: 'gpt-4o' }
    } as any)

    expect(lookupModelMock).toHaveBeenCalledWith('openai', 'gpt-4o')
    expect(createMock).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'gpt-4o' }, registryData)
  })

  it('falls back to custom model creation when registry lookup fails', async () => {
    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})
    lookupModelMock.mockRejectedValue(new Error('registry down'))
    createMock.mockResolvedValue({ id: 'openai::custom-model' })

    await modelHandlers['/models'].POST({
      body: { providerId: 'openai', modelId: 'custom-model' }
    } as any)

    expect(createMock).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'custom-model' }, undefined)
    expect(warnSpy).toHaveBeenCalledWith(
      'Registry lookup failed during create, falling back to custom',
      expect.objectContaining({ providerId: 'openai', modelId: 'custom-model' })
    )
  })
})
