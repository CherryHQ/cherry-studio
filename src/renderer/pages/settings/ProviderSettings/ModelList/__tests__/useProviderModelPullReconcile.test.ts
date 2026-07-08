import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderModelPullReconcile } from '../useProviderModelPullReconcile'

const createModelsMock = vi.fn()
const deleteModelsMock = vi.fn()
const enableProviderWhenModelsAvailableMock = vi.fn()
const fetchProviderCatalogModelsMock = vi.fn()
const fetchResolvedProviderModelsMock = vi.fn()
const toCreateModelDtoMock = vi.fn((providerId, model) => ({
  providerId,
  modelId: model.apiModelId,
  name: model.name,
  group: model.group
}))
const updateProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderMock = vi.fn()

vi.mock('@renderer/hooks/useModel', () => ({
  useModelMutations: () => ({
    createModels: createModelsMock,
    deleteModels: deleteModelsMock,
    isCreating: false,
    isDeleting: false,
    isBulkDeleting: false
  }),
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/utils/modelSync', () => ({
  fetchProviderCatalogModels: (providerId: string) => fetchProviderCatalogModelsMock(providerId),
  fetchResolvedProviderModels: (providerId: string) => fetchResolvedProviderModelsMock(providerId),
  toCreateModelDto: (providerId: string, model: any) => toCreateModelDtoMock(providerId, model)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/utils/providerEnablement', () => ({
  enableProviderWhenModelsAvailable: (...args: any[]) => enableProviderWhenModelsAvailableMock(...args)
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const localModel = {
  id: 'openai::local-model',
  providerId: 'openai',
  apiModelId: 'local-model',
  name: 'Local Model',
  group: 'OpenAI'
}

const catalogModel = {
  id: 'openai::catalog-model',
  providerId: 'openai',
  apiModelId: 'catalog-model',
  name: 'Catalog Model',
  group: 'OpenAI'
}

const fetchedModel = {
  id: 'openai::fetched-model',
  providerId: 'openai',
  apiModelId: 'fetched-model',
  name: 'Fetched Model',
  group: 'OpenAI'
}

describe('useProviderModelPullReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createModelsMock.mockResolvedValue([])
    deleteModelsMock.mockResolvedValue(undefined)
    enableProviderWhenModelsAvailableMock.mockResolvedValue(false)
    fetchProviderCatalogModelsMock.mockResolvedValue([catalogModel])
    fetchResolvedProviderModelsMock.mockResolvedValue([fetchedModel])
    useModelsMock.mockReturnValue({ models: [localModel] })
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false },
      updateProvider: updateProviderMock
    })
  })

  it('opens the drawer and loads catalog, fetched, and local models', async () => {
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    expect(result.current.pullReconcileDrawerOpen).toBe(true)
    await waitFor(() => {
      expect(result.current.allModels).toEqual([catalogModel, fetchedModel, localModel])
    })
    expect(fetchProviderCatalogModelsMock).toHaveBeenCalledWith('openai')
    expect(fetchResolvedProviderModelsMock).toHaveBeenCalledWith('openai')
  })

  it('adds only models that are not already local and enables the provider when models exist', async () => {
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.addModels([localModel as any, fetchedModel as any])
    })

    expect(createModelsMock).toHaveBeenCalledWith([
      {
        providerId: 'openai',
        modelId: 'fetched-model',
        name: 'Fetched Model',
        group: 'OpenAI'
      }
    ])
    expect(enableProviderWhenModelsAvailableMock).toHaveBeenCalledWith(
      { id: 'openai', isEnabled: false },
      updateProviderMock,
      2,
      'model_manage_add'
    )
  })

  it('removes unique local model ids', async () => {
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.removeModels(['openai::local-model', 'openai::local-model'])
    })

    expect(deleteModelsMock).toHaveBeenCalledWith(['openai::local-model'])
  })

  it('skips default models and removes the remaining models', async () => {
    const defaultModelError = DataApiErrorFactory.invalidOperation(
      'delete model openai/default-model',
      'model is in use as the default model'
    )
    deleteModelsMock.mockRejectedValueOnce(defaultModelError).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.removeModels(['openai::local-model', 'openai::default-model'])
    })

    expect(deleteModelsMock).toHaveBeenNthCalledWith(1, ['openai::local-model', 'openai::default-model'])
    expect(deleteModelsMock).toHaveBeenNthCalledWith(2, ['openai::local-model'])
    expect(toast.warning).toHaveBeenCalledWith('settings.models.manage.remove_skipped_default_in_use')
  })

  it('shows an error toast when loading provider models fails', async () => {
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('settings.models.manage.sync_pull_failed')
    })
  })
})
