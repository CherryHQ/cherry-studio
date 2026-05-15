import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../providerSetting/constants'
import { useProviderModelSync } from '../useProviderModelSync'

const dataApiGetMock = vi.fn()
const useModelsMock = vi.fn()
const createModelsMock = vi.fn()
const fetchResolvedProviderModelsMock = vi.fn()

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: (...args: any[]) => dataApiGetMock(...args)
  }
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: () => ({
    createModels: createModelsMock,
    isCreating: false
  })
}))

vi.mock('../../ModelList/modelSync', () => ({
  fetchResolvedProviderModels: (...args: any[]) => fetchResolvedProviderModelsMock(...args),
  toCreateModelDto: (_providerId: string, model: any) => ({
    providerId: model.providerId,
    modelId: model.id.split(':')[1],
    name: model.name
  })
}))

describe('useProviderModelSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelsMock.mockReturnValue({ models: [] })
    createModelsMock.mockResolvedValue([])
    dataApiGetMock.mockResolvedValue([])
  })

  it('disables fallback model fetching when existing models are supplied', async () => {
    const existingModels = [{ id: 'openai:model-alpha', providerId: 'openai', name: 'Alpha' }] as any
    const { result } = renderHook(() => useProviderModelSync('openai', { existingModels }))

    await act(async () => {
      await result.current.syncProviderModels()
    })

    expect(useModelsMock).toHaveBeenCalledWith(
      { providerId: 'openai' },
      {
        fetchEnabled: false,
        swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS
      }
    )
    expect(dataApiGetMock).not.toHaveBeenCalled()
    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()
    expect(createModelsMock).not.toHaveBeenCalled()
  })

  it('checks the latest server models before inserting and skips create when any already exist', async () => {
    const serverModels = [{ id: 'zhipu::glm-4.5', providerId: 'zhipu', name: 'GLM-4.5' }] as any
    dataApiGetMock.mockResolvedValue(serverModels)

    const { result } = renderHook(() => useProviderModelSync('zhipu', { existingModels: [] }))

    await act(async () => {
      const synced = await result.current.syncProviderModels()
      expect(synced).toEqual(serverModels)
    })

    expect(dataApiGetMock).toHaveBeenCalledWith('/models', {
      query: { providerId: 'zhipu' }
    })
    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()
    expect(createModelsMock).not.toHaveBeenCalled()
  })

  it('creates models only when both current snapshot and latest server models are empty', async () => {
    fetchResolvedProviderModelsMock.mockResolvedValue([
      { id: 'openai:model-alpha', providerId: 'openai', name: 'Alpha' },
      { id: 'openai:model-beta', providerId: 'openai', name: 'Beta' }
    ])
    createModelsMock.mockResolvedValue([{ id: 'openai:model-alpha' }, { id: 'openai:model-beta' }])

    const { result } = renderHook(() => useProviderModelSync('openai', { existingModels: [] }))

    await act(async () => {
      await result.current.syncProviderModels()
    })

    expect(dataApiGetMock).toHaveBeenCalledWith('/models', {
      query: { providerId: 'openai' }
    })
    expect(fetchResolvedProviderModelsMock).toHaveBeenCalledWith('openai', { id: 'openai' })
    expect(createModelsMock).toHaveBeenCalledTimes(1)
  })
})
