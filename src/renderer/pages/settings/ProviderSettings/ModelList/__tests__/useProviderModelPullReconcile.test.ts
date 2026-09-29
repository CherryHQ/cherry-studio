import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { useProviderModelPullReconcile } from '../useProviderModelPullReconcile'

const { reconcileTriggerMock } = vi.hoisted(() => ({
  reconcileTriggerMock: vi.fn()
}))
const createModelsMock = vi.fn()
const deleteModelsMock = vi.fn()
const enableProviderWhenModelsAvailableMock = vi.fn()
const fetchResolvedProviderModelsMock = vi.fn()
const resolveCreateModelEndpointTypesMock = vi.fn()
const toCreateModelDtoMock = vi.fn((providerId, model, endpointTypes) => ({
  providerId,
  modelId: model.apiModelId,
  name: model.name,
  group: model.group,
  endpointTypes
}))
const enableProviderMock = vi.fn()
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
  fetchResolvedProviderModels: (providerId: string) => fetchResolvedProviderModelsMock(providerId),
  resolveCreateModelEndpointTypes: (...args: any[]) => resolveCreateModelEndpointTypesMock(...args),
  toCreateModelDto: (providerId: string, model: any, endpointTypes: any) =>
    toCreateModelDtoMock(providerId, model, endpointTypes)
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
  presetModelId: 'local-model',
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('useProviderModelPullReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/providers/:providerId/models:reconcile', reconcileTriggerMock)
    createModelsMock.mockResolvedValue([])
    deleteModelsMock.mockResolvedValue(undefined)
    reconcileTriggerMock.mockResolvedValue([])
    enableProviderWhenModelsAvailableMock.mockResolvedValue(undefined)
    fetchResolvedProviderModelsMock.mockResolvedValue({ models: [fetchedModel] })
    resolveCreateModelEndpointTypesMock.mockReturnValue(undefined)
    useModelsMock.mockReturnValue({ models: [localModel] })
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false },
      enableProvider: enableProviderMock
    })
  })

  it('opens the drawer using the resolved list and saved models without appending catalog entries', async () => {
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    expect(result.current.pullReconcileDrawerOpen).toBe(true)
    await waitFor(() => {
      expect(result.current.allModels).toEqual([fetchedModel, localModel])
    })
    expect(result.current.staleModelCount).toBe(1)
    expect(result.current.staleModelIds).toEqual(['openai::local-model'])
    expect(fetchResolvedProviderModelsMock).toHaveBeenCalledWith('openai')
  })

  it('uses current discovered metadata when a saved model has the same id', async () => {
    const saved = { ...fetchedModel, endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] }
    const discovered = { ...fetchedModel, endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] }
    useModelsMock.mockReturnValue({ models: [saved] })
    fetchResolvedProviderModelsMock.mockResolvedValueOnce({ models: [discovered] })
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))
    await act(async () => {
      await result.current.reloadModels()
    })
    expect(result.current.allModels).toEqual([discovered])
  })

  it('does not mark custom local models as stale when they are missing remotely', async () => {
    useModelsMock.mockReturnValue({
      models: [
        {
          ...localModel,
          id: 'openai::custom-local-model',
          apiModelId: 'custom-local-model',
          presetModelId: null
        }
      ]
    })
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.staleModelCount).toBe(0)
    })

    await act(async () => {
      await result.current.cleanStaleModels()
    })

    expect(reconcileTriggerMock).not.toHaveBeenCalled()
  })

  it('marks local models from the remote list as removable even without a preset model id', async () => {
    useModelsMock.mockReturnValue({
      models: [
        {
          ...fetchedModel,
          presetModelId: null
        }
      ]
    })
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.removableModelIds).toEqual(['openai::fetched-model'])
    })
  })

  it('excludes chat, quick-assistant, and translate default models from removable models', async () => {
    const regularModel = {
      ...localModel,
      id: 'openai::regular-model',
      apiModelId: 'regular-model',
      presetModelId: 'regular-model'
    }
    useModelsMock.mockReturnValue({
      models: [
        localModel,
        { ...fetchedModel, presetModelId: 'fetched-model' },
        { ...catalogModel, presetModelId: 'catalog-model' },
        regularModel
      ]
    })
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.default_model_id': localModel.id,
      'feature.quick_assistant.model_id': fetchedModel.id,
      'feature.translate.model_id': catalogModel.id
    })

    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.removableModelIds).toEqual([regularModel.id])
    })
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
        group: 'OpenAI',
        endpointTypes: undefined
      }
    ])
    expect(resolveCreateModelEndpointTypesMock).toHaveBeenCalledWith({ id: 'openai', isEnabled: false }, fetchedModel)
    expect(enableProviderWhenModelsAvailableMock).toHaveBeenCalledWith(
      { id: 'openai', isEnabled: false },
      enableProviderMock,
      2,
      'model_manage_add'
    )
  })

  it('adds more than 500 models in sequential batches before enabling the provider', async () => {
    const remoteModels = Array.from({ length: 804 }, (_, index) => ({
      id: `openai::remote-model-${index}`,
      providerId: 'openai',
      apiModelId: `remote-model-${index}`,
      name: `Remote Model ${index}`,
      group: 'OpenAI'
    }))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.addModels(remoteModels as any)
    })

    expect(createModelsMock).toHaveBeenCalledTimes(2)
    expect(createModelsMock.mock.calls[0]?.[0]).toHaveLength(500)
    expect(createModelsMock.mock.calls[0]?.[0][0]?.modelId).toBe('remote-model-0')
    expect(createModelsMock.mock.calls[0]?.[0][499]?.modelId).toBe('remote-model-499')
    expect(createModelsMock.mock.calls[1]?.[0]).toHaveLength(304)
    expect(createModelsMock.mock.calls[1]?.[0][0]?.modelId).toBe('remote-model-500')
    expect(createModelsMock.mock.calls[1]?.[0][303]?.modelId).toBe('remote-model-803')
    expect(enableProviderWhenModelsAvailableMock).toHaveBeenCalledTimes(1)
    expect(enableProviderWhenModelsAvailableMock).toHaveBeenCalledWith(
      { id: 'openai', isEnabled: false },
      enableProviderMock,
      805,
      'model_manage_add'
    )
  })

  it('shows an operation failure toast when adding models fails', async () => {
    createModelsMock.mockRejectedValueOnce(new Error('create failed'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.addModels([fetchedModel as any])
    })

    expect(toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
  })

  it('keeps sending the batches after one fails and reports the library it left behind', async () => {
    const remoteModels = Array.from({ length: 804 }, (_, index) => ({
      id: `openai::remote-model-${index}`,
      providerId: 'openai',
      apiModelId: `remote-model-${index}`,
      name: `Remote Model ${index}`,
      group: 'OpenAI'
    }))
    // The first 500 land, the remaining 304 do not: the operation is partial, and
    // the report has to name that instead of a flat failure.
    createModelsMock.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('second batch failed'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.addModels(remoteModels as any)
    })

    expect(createModelsMock).toHaveBeenCalledTimes(2)
    expect(toast.warning).toHaveBeenCalledWith('settings.models.manage.add_partial_failure')
    expect(toast.error).not.toHaveBeenCalledWith('settings.models.manage.operation_failed')
    // The provider is enabled for the model set the user asked for, not for part
    // of it: the retry that completes the library enables it.
    expect(enableProviderWhenModelsAvailableMock).not.toHaveBeenCalled()
  })

  it('does not enable the provider when every batch fails', async () => {
    const remoteModels = Array.from({ length: 804 }, (_, index) => ({
      id: `openai::remote-model-${index}`,
      providerId: 'openai',
      apiModelId: `remote-model-${index}`,
      name: `Remote Model ${index}`,
      group: 'OpenAI'
    }))
    createModelsMock.mockRejectedValue(new Error('create failed'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.addModels(remoteModels as any)
    })

    expect(createModelsMock).toHaveBeenCalledTimes(2)
    expect(enableProviderWhenModelsAvailableMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
  })

  it('warns that models were added when provider enablement fails', async () => {
    enableProviderWhenModelsAvailableMock.mockRejectedValueOnce(new Error('enable failed'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.addModels([fetchedModel as any])
    })

    expect(createModelsMock).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('settings.models.manage.add_success_enable_failed')
    expect(toast.error).not.toHaveBeenCalledWith('settings.models.manage.operation_failed')
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

  it.each(['comfyui', 'ollama'])('keeps missing %s models until the user removes them', async (providerId) => {
    const saved = {
      ...localModel,
      id: `${providerId}::saved-model`,
      providerId,
      apiModelId: 'saved-model',
      presetModelId: null
    }
    useModelsMock.mockReturnValue({ models: [saved] })
    useProviderMock.mockReturnValue({
      provider: { id: providerId, isEnabled: true },
      enableProvider: enableProviderMock
    })
    fetchResolvedProviderModelsMock.mockResolvedValue({ models: [] })
    const { result } = renderHook(() => useProviderModelPullReconcile(providerId))
    act(() => {
      result.current.openPullReconcile()
    })
    await waitFor(() => {
      expect(result.current.isLoadingModels).toBe(false)
    })
    expect(result.current.allModels).toEqual([saved])
    expect(result.current.removableModelIds).toEqual([saved.id])
    expect(result.current.staleModelCount).toBe(0)
    expect(reconcileTriggerMock).not.toHaveBeenCalled()
    expect(deleteModelsMock).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.removeModels(result.current.removableModelIds)
    })
    expect(deleteModelsMock).toHaveBeenCalledWith([saved.id])
  })

  it('deletes nothing when the provider list does not load', async () => {
    // ComfyUI unreachable: an empty result is not "every model is gone".
    const saved = { ...localModel, id: 'comfyui::sample_workflow_removed', providerId: 'comfyui' }
    useModelsMock.mockReturnValue({ models: [saved] })
    useProviderMock.mockReturnValue({
      provider: { id: 'comfyui', isEnabled: true },
      enableProvider: enableProviderMock
    })
    fetchResolvedProviderModelsMock.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useProviderModelPullReconcile('comfyui'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.loadErrorMessage).toBeTruthy()
    })
    expect(reconcileTriggerMock).not.toHaveBeenCalled()
    expect(deleteModelsMock).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows the names of unlisted models for any provider', async () => {
    useModelsMock.mockReturnValue({ models: [] })
    fetchResolvedProviderModelsMock.mockResolvedValue({
      models: [],
      skippedModels: ['sample #frag', 'sample ?query']
    })
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))
    await act(async () => {
      await result.current.reloadModels()
    })
    expect(toast.warning).toHaveBeenCalledWith({
      title: 'settings.models.manage.models_not_listed',
      description: 'sample #frag, sample ?query'
    })
  })

  it('keeps a hand-added model when it is absent from the discovered list', async () => {
    const handAdded = { ...localModel, id: 'openai::hand-added', apiModelId: 'hand-added', presetModelId: null }
    useModelsMock.mockReturnValue({ models: [handAdded] })
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.allModels).toHaveLength(2)
    })
    expect(result.current.allModels).toContain(handAdded)
    expect(reconcileTriggerMock).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows an operation failure toast when removing models fails for a non-default error', async () => {
    deleteModelsMock.mockRejectedValueOnce(new Error('delete failed'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      await result.current.removeModels(['openai::local-model'])
    })

    expect(toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
  })

  it('cleans stale models through reconcile', async () => {
    reconcileTriggerMock.mockResolvedValueOnce([catalogModel, fetchedModel])
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.staleModelCount).toBe(1)
    })

    await act(async () => {
      await result.current.cleanStaleModels()
    })

    expect(reconcileTriggerMock).toHaveBeenCalledWith({
      params: { providerId: 'openai' },
      body: {
        toAdd: [],
        toRemove: ['openai::local-model']
      }
    })
    expect(toast.success).toHaveBeenCalledWith('settings.models.manage.clean_stale_success')
  })

  it('warns when cleaning stale models skips models still in use', async () => {
    reconcileTriggerMock.mockResolvedValueOnce([catalogModel, fetchedModel, localModel])
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.staleModelCount).toBe(1)
    })

    await act(async () => {
      await result.current.cleanStaleModels()
    })

    expect(toast.warning).toHaveBeenCalledWith('settings.models.manage.remove_skipped_default_in_use')
  })

  it('shows an operation failure toast when cleaning stale models fails', async () => {
    reconcileTriggerMock.mockRejectedValueOnce(new Error('reconcile failed'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.staleModelCount).toBe(1)
    })

    await act(async () => {
      await result.current.cleanStaleModels()
    })

    expect(toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
  })

  it('keeps load failures in drawer state instead of showing a toast', async () => {
    const apiKey = 'sk-should-not-reach-logs'
    const loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(new Error(`upstream failed for ${apiKey}`))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    try {
      act(() => {
        result.current.openPullReconcile()
      })

      await waitFor(() => {
        expect(result.current.loadErrorMessage).toBe('settings.models.manage.sync_pull_failed')
      })
      expect(result.current.allModels).toEqual([localModel])
      expect(toast.error).not.toHaveBeenCalledWith('settings.models.manage.sync_pull_failed')
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to load provider models for manage drawer', {
        providerId: 'openai',
        category: 'unknown'
      })
      expect(JSON.stringify(loggerErrorSpy.mock.calls)).not.toContain(apiKey)
    } finally {
      loggerErrorSpy.mockRestore()
    }
  })

  it('surfaces the proxy/SSL diagnosis when the upstream fetch fails on a certificate', async () => {
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(
      new Error('Cannot connect to API: net::ERR_CERT_AUTHORITY_INVALID')
    )
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.loadErrorMessage).toBe('error.diagnosis.proxy')
    })
  })

  it('preserves saved models without treating a failed load as an empty remote list', async () => {
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(new Error('upstream unsupported'))
    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    act(() => {
      result.current.openPullReconcile()
    })

    await waitFor(() => {
      expect(result.current.loadErrorMessage).toBe('settings.models.manage.sync_pull_failed')
    })
    expect(result.current.allModels).toEqual([localModel])
    expect(result.current.staleModelCount).toBe(0)
  })

  it('ignores stale model load results when a newer load finishes first', async () => {
    const oldFetched = { ...fetchedModel, id: 'openai::old-fetched', apiModelId: 'old-fetched', name: 'Old Fetched' }
    const newFetched = { ...fetchedModel, id: 'openai::new-fetched', apiModelId: 'new-fetched', name: 'New Fetched' }
    const oldFetchedLoad = deferred<any[]>()

    fetchResolvedProviderModelsMock
      .mockReturnValueOnce(oldFetchedLoad.promise.then((models) => ({ models })))
      .mockResolvedValueOnce({ models: [newFetched] })

    const { result } = renderHook(() => useProviderModelPullReconcile('openai'))

    await act(async () => {
      void result.current.reloadModels()
      await result.current.reloadModels()
    })

    expect(result.current.allModels).toEqual([newFetched, localModel])

    await act(async () => {
      oldFetchedLoad.resolve([oldFetched])
      await oldFetchedLoad.promise
    })

    expect(result.current.allModels).toEqual([newFetched, localModel])
  })
})
