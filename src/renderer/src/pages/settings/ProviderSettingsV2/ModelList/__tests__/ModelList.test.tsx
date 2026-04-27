import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useModelListActions } from '../useModelListActions'
import { useModelListSections } from '../useModelListSections'

const downloadModelShowMock = vi.fn()
const updateModelMock = vi.fn()

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useModelMutationsMock = vi.fn()

const models = [
  {
    id: 'openai::reasoning-alpha',
    name: 'Alpha',
    capabilities: ['reasoning'],
    isEnabled: true,
    providerId: 'openai'
  },
  {
    id: 'openai::model-beta',
    name: 'Beta',
    capabilities: ['embedding'],
    isEnabled: false,
    providerId: 'openai'
  }
] as any

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: (...args: any[]) => useModelMutationsMock(...args)
}))

vi.mock('../modelListFiltersContext', () => ({
  useModelListFilters: () => ({
    searchText: '',
    selectedCapabilityFilter: 'all'
  })
}))

vi.mock('../modelListHealthContext', () => ({
  useModelListHealth: () => ({
    isHealthChecking: false,
    modelStatusMap: new Map([['openai::reasoning-alpha', { status: 'success', checking: false, keyResults: [] }]])
  })
}))

vi.mock('../../hooks/useProviderModelSync', () => ({
  useProviderModelSync: () => ({
    isSyncingModels: false
  })
}))

vi.mock('../DownloadOVMSModelPopup', () => ({
  default: { show: (...args: any[]) => downloadModelShowMock(...args) }
}))

describe('ModelList owner surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useProviderMock.mockImplementation((providerId: string) => ({
      provider: { id: providerId, name: providerId }
    }))
    useModelsMock.mockReturnValue({ models })
    useModelMutationsMock.mockReturnValue({
      updateModel: updateModelMock
    })
  })

  it('opens manage drawer with inline custom add intent and opens sync drawer on refresh', async () => {
    const { result } = renderHook(() => useModelListActions({ providerId: 'openai' }))

    expect(result.current.openManageWithInlineCustomAdd).toBe(false)
    expect(result.current.manageModelsOpen).toBe(false)

    act(() => {
      result.current.onAddModel()
    })

    expect(result.current.manageModelsOpen).toBe(true)
    expect(result.current.openManageWithInlineCustomAdd).toBe(true)

    act(() => {
      result.current.closeManageModels()
    })

    expect(result.current.manageModelsOpen).toBe(false)
    expect(result.current.openManageWithInlineCustomAdd).toBe(false)

    act(() => {
      result.current.onRefreshModels()
    })

    expect(result.current.modelListSyncOpen).toBe(true)
    expect(result.current.manageModelsOpen).toBe(false)

    await act(async () => {
      await result.current.updateVisibleModelsEnabledState(models, true)
    })

    expect(updateModelMock).toHaveBeenCalledWith('openai', 'model-beta', { isEnabled: true })
  })

  it('keeps new-api add flow on manage drawer and preserves the ovms download popup path', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'new-api', name: 'new-api' }
    })

    const newApiActions = renderHook(() => useModelListActions({ providerId: 'new-api' }))

    act(() => {
      newApiActions.result.current.onAddModel()
    })

    expect(newApiActions.result.current.manageModelsOpen).toBe(true)
    expect(newApiActions.result.current.openManageWithInlineCustomAdd).toBe(true)

    useProviderMock.mockReturnValue({
      provider: { id: 'ovms', name: 'ovms' }
    })
    const ovmsActions = renderHook(() => useModelListActions({ providerId: 'ovms' }))

    act(() => {
      ovmsActions.result.current.onDownloadModel()
    })

    expect(downloadModelShowMock).toHaveBeenCalled()
  })

  it('opens local edit drawer state in the sections owner', () => {
    const { result } = renderHook(() => useModelListSections({ providerId: 'openai' }))

    expect(result.current.editModelDrawerOpen).toBe(false)
    expect(result.current.enabledSections[0]?.items[0]?.model.name).toBe('Alpha')

    act(() => {
      result.current.onEditModel(models[0])
    })

    expect(result.current.editModelDrawerOpen).toBe(true)
    expect(result.current.editingModel?.name).toBe('Alpha')
  })
})
