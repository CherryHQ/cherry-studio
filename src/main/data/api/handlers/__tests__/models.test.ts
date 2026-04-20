import type { BatchCreateModelInput } from '@data/services/ModelService'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import { CreateModelsBatchDtoSchema, MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../tests/__mocks__/MainLoggerService'

const { listMock, createMock, getByKeyMock, updateMock, deleteMock, batchCreateMock, lookupModelMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    createMock: vi.fn(),
    getByKeyMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    batchCreateMock: vi.fn(),
    lookupModelMock: vi.fn()
  })
)

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    list: listMock,
    create: createMock,
    getByKey: getByKeyMock,
    update: updateMock,
    delete: deleteMock,
    batchCreate: batchCreateMock
  }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    lookupModel: lookupModelMock
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

describe('/models', () => {
  it('delegates GET to modelService.list with an empty query when none is provided', async () => {
    listMock.mockResolvedValueOnce([{ id: 'openai::gpt-4' }])

    const result = await modelHandlers['/models'].GET({} as never)

    expect(listMock).toHaveBeenCalledWith({})
    expect(result).toEqual([{ id: 'openai::gpt-4' }])
  })

  it('forwards a provided GET query to modelService.list', async () => {
    listMock.mockResolvedValueOnce([])

    await modelHandlers['/models'].GET({ query: { providerId: 'openai' } } as never)

    expect(listMock).toHaveBeenCalledWith({ providerId: 'openai' })
  })

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

describe('/models/:uniqueModelId*', () => {
  it('splits a slash-containing uniqueModelId at the first :: and forwards GET', async () => {
    const model = { id: 'fireworks::accounts/fireworks/models/deepseek-v3p2' }
    getByKeyMock.mockResolvedValueOnce(model)

    const result = await modelHandlers['/models/:uniqueModelId*'].GET({
      params: { uniqueModelId: 'fireworks::accounts/fireworks/models/deepseek-v3p2' }
    } as never)

    expect(getByKeyMock).toHaveBeenCalledWith('fireworks', 'accounts/fireworks/models/deepseek-v3p2')
    expect(result).toBe(model)
  })

  it('splits a slash-containing uniqueModelId at the first :: and forwards PATCH with body', async () => {
    const updated = { id: 'qwen::qwen/qwen3-vl', isEnabled: false }
    updateMock.mockResolvedValueOnce(updated)

    const result = await modelHandlers['/models/:uniqueModelId*'].PATCH({
      params: { uniqueModelId: 'qwen::qwen/qwen3-vl' },
      body: { isEnabled: false }
    } as never)

    expect(updateMock).toHaveBeenCalledWith('qwen', 'qwen/qwen3-vl', { isEnabled: false })
    expect(result).toBe(updated)
  })
  it('splits a slash-containing uniqueModelId at the first :: and forwards DELETE', async () => {
    deleteMock.mockResolvedValueOnce(undefined)

    const result = await modelHandlers['/models/:uniqueModelId*'].DELETE({
      params: { uniqueModelId: 'fireworks::accounts/fireworks/models/deepseek-v3p2' }
    } as never)

    expect(deleteMock).toHaveBeenCalledWith('fireworks', 'accounts/fireworks/models/deepseek-v3p2')
    expect(result).toBeUndefined()
  })

  it('splits on the FIRST :: when the modelId itself contains ::', async () => {
    const model = { id: 'openai::ns::model' }
    getByKeyMock.mockResolvedValueOnce(model)

    await modelHandlers['/models/:uniqueModelId*'].GET({
      params: { uniqueModelId: 'openai::ns::model' }
    } as never)

    expect(getByKeyMock).toHaveBeenCalledWith('openai', 'ns::model')
  })

  it.each([
    ['empty modelId', 'openai::', 'openai', ''],
    ['empty providerId', '::gpt-4', '', 'gpt-4']
  ])('passes %s through to the service (contract pinned)', async (_label, uniqueModelId, providerId, modelId) => {
    getByKeyMock.mockResolvedValueOnce(null)

    await modelHandlers['/models/:uniqueModelId*'].GET({
      params: { uniqueModelId }
    } as never)

    expect(getByKeyMock).toHaveBeenCalledWith(providerId, modelId)
  })

  it('rejects an id missing the :: separator with a 422 validation error', async () => {
    await expect(
      modelHandlers['/models/:uniqueModelId*'].GET({ params: { uniqueModelId: 'no-separator' } } as never)
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

    expect(getByKeyMock).not.toHaveBeenCalled()
  })

  it('propagates service errors without wrapping them', async () => {
    const serviceError = DataApiErrorFactory.notFound('Model', 'openai/missing')
    getByKeyMock.mockRejectedValueOnce(serviceError)

    await expect(
      modelHandlers['/models/:uniqueModelId*'].GET({ params: { uniqueModelId: 'openai::missing' } } as never)
    ).rejects.toBe(serviceError)
  })
})
