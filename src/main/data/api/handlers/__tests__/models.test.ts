import type { CreateModelInput } from '@data/services/ModelService'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import { CreateModelsSchema, MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../tests/__mocks__/MainLoggerService'

const { listMock, getByKeyMock, updateMock, deleteMock, createMock, lookupModelMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getByKeyMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  createMock: vi.fn(),
  lookupModelMock: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    list: listMock,
    getByKey: getByKeyMock,
    update: updateMock,
    delete: deleteMock,
    create: createMock
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
  it('accepts create payload arrays up to the configured limit', () => {
    const items = Array.from({ length: MODELS_BATCH_MAX_ITEMS }, (_, index) => ({
      providerId: 'openai',
      modelId: `gpt-${index}`
    }))

    expect(() => CreateModelsSchema.parse(items)).not.toThrow()
  })

  it('rejects single-object payloads for /models', () => {
    expect(() => CreateModelsSchema.parse({ providerId: 'openai', modelId: 'gpt-4o' })).toThrow()
  })

  it('rejects create payload arrays over the configured limit', () => {
    const items = Array.from({ length: MODELS_BATCH_MAX_ITEMS + 1 }, (_, index) => ({
      providerId: 'openai',
      modelId: `gpt-${index}`
    }))

    expect(() => CreateModelsSchema.parse(items)).toThrow()
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

  it('passes registry data to modelService.create for a single-item array', async () => {
    const registryData = {
      presetModel: { id: 'gpt-4o', name: 'GPT-4o' },
      registryOverride: null,
      defaultChatEndpoint: 'openai-chat-completions' as const,
      reasoningFormatTypes: {}
    }
    lookupModelMock.mockResolvedValue(registryData)
    createMock.mockResolvedValue([{ id: 'openai::gpt-4o' }])

    await modelHandlers['/models'].POST({
      body: [{ providerId: 'openai', modelId: 'gpt-4o' }]
    } as any)

    expect(lookupModelMock).toHaveBeenCalledWith('openai', 'gpt-4o')
    expect(createMock).toHaveBeenCalledWith([
      {
        dto: { providerId: 'openai', modelId: 'gpt-4o' },
        registryData
      }
    ] satisfies CreateModelInput[])
  })

  it('falls back to custom model creation when registry lookup fails', async () => {
    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})
    lookupModelMock.mockRejectedValue(new Error('registry down'))
    createMock.mockResolvedValue([{ id: 'openai::custom-model' }])

    await modelHandlers['/models'].POST({
      body: [{ providerId: 'openai', modelId: 'custom-model' }]
    } as any)

    expect(createMock).toHaveBeenCalledWith([
      {
        dto: { providerId: 'openai', modelId: 'custom-model' },
        registryData: undefined
      }
    ] satisfies CreateModelInput[])
    expect(warnSpy).toHaveBeenCalledWith(
      'Registry lookup failed during create, falling back to custom',
      expect.objectContaining({ providerId: 'openai', modelId: 'custom-model' })
    )
  })

  it('accepts a bare array body and delegates to create', async () => {
    const registryData1 = { presetModel: { id: 'gpt-4o', name: 'GPT-4o' }, registryOverride: null }
    const registryData2 = { presetModel: { id: 'gpt-5', name: 'GPT-5' }, registryOverride: null }
    const created = [{ id: 'openai::gpt-4o' }, { id: 'openai::gpt-5' }]

    lookupModelMock.mockResolvedValueOnce(registryData1).mockResolvedValueOnce(registryData2)
    createMock.mockResolvedValue(created)

    const result = await modelHandlers['/models'].POST({
      body: [
        { providerId: 'openai', modelId: 'gpt-4o' },
        { providerId: 'openai', modelId: 'gpt-5' }
      ]
    } as any)

    expect(createMock).toHaveBeenCalledWith([
      {
        dto: { providerId: 'openai', modelId: 'gpt-4o' },
        registryData: registryData1
      },
      {
        dto: { providerId: 'openai', modelId: 'gpt-5' },
        registryData: registryData2
      }
    ] satisfies CreateModelInput[])
    expect(result).toEqual(created)
  })

  it('falls back to custom model creation when registry lookup fails for one batch item', async () => {
    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})
    const registryData = { presetModel: { id: 'gpt-4o', name: 'GPT-4o' }, registryOverride: null }

    lookupModelMock.mockResolvedValueOnce(registryData).mockRejectedValueOnce(new Error('lookup failed'))
    createMock.mockResolvedValue([])

    await modelHandlers['/models'].POST({
      body: [
        { providerId: 'openai', modelId: 'gpt-4o' },
        { providerId: 'custom/provider', modelId: 'my-model' }
      ]
    } as any)

    expect(createMock).toHaveBeenCalledWith([
      {
        dto: { providerId: 'openai', modelId: 'gpt-4o' },
        registryData
      },
      {
        dto: { providerId: 'custom/provider', modelId: 'my-model' },
        registryData: undefined
      }
    ] satisfies CreateModelInput[])
    expect(warnSpy).toHaveBeenCalledWith(
      'Registry lookup failed during batch create, falling back to custom',
      expect.objectContaining({ providerId: 'custom/provider', modelId: 'my-model' })
    )
  })

  it('propagates create service errors without wrapping them', async () => {
    const serviceError = DataApiErrorFactory.conflict('Model', 'openai/gpt-4o')
    const registryData = { presetModel: { id: 'gpt-4o', name: 'GPT-4o' }, registryOverride: null }

    lookupModelMock.mockResolvedValueOnce(registryData)
    createMock.mockRejectedValueOnce(serviceError)

    await expect(
      modelHandlers['/models'].POST({
        body: [{ providerId: 'openai', modelId: 'gpt-4o' }]
      } as any)
    ).rejects.toBe(serviceError)
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
