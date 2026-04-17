import { DataApiErrorFactory } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, createMock, getByKeyMock, updateMock, deleteMock, lookupModelMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  getByKeyMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  lookupModelMock: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    list: listMock,
    create: createMock,
    getByKey: getByKeyMock,
    update: updateMock,
    delete: deleteMock
  }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    lookupModel: lookupModelMock
  }
}))

import { modelHandlers } from '../models'

describe('modelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    it('looks up registry data, then delegates POST to modelService.create with the result', async () => {
      const registryData = { presetModel: null, registryOverride: null }
      const createdModel = { id: 'openai::gpt-4', providerId: 'openai' }
      lookupModelMock.mockResolvedValueOnce(registryData)
      createMock.mockResolvedValueOnce(createdModel)

      const body = { providerId: 'openai', modelId: 'gpt-4' }
      const result = await modelHandlers['/models'].POST({ body } as never)

      expect(lookupModelMock).toHaveBeenCalledWith('openai', 'gpt-4')
      expect(createMock).toHaveBeenCalledWith(body, registryData)
      expect(result).toBe(createdModel)
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

    it('rejects an id missing the :: separator before touching the service', async () => {
      await expect(
        modelHandlers['/models/:uniqueModelId*'].GET({ params: { uniqueModelId: 'no-separator' } } as never)
      ).rejects.toThrow(/Invalid UniqueModelId/)

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
})
