import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderModelListBrowse } from '../useProviderModelListBrowse'

const useModelsMock = vi.fn()
const updateModelMock = vi.fn()

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

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: () => ({
    updateModel: updateModelMock
  })
}))

describe('useProviderModelListBrowse', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useModelsMock.mockReturnValue({ models, isLoading: false })
    updateModelMock.mockResolvedValue(undefined)
  })

  it('opens local edit drawer state when editing a model', () => {
    const { result } = renderHook(() => useProviderModelListBrowse({ providerId: 'openai' }))

    expect(result.current.editDrawer.open).toBe(false)
    expect(result.current.sections.enabledSections[0]?.items[0]?.model.name).toBe('Alpha')

    act(() => {
      result.current.sections.onEditModel(models[0])
    })

    expect(result.current.editDrawer.open).toBe(true)
    expect(result.current.editDrawer.model?.name).toBe('Alpha')
  })

  it('bulk-enables only the currently visible filtered models', async () => {
    const { result } = renderHook(() => useProviderModelListBrowse({ providerId: 'openai' }))

    act(() => {
      result.current.header.setSearchText('Beta')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(1)
    })

    await act(() => result.current.header.onToggleVisibleModels(true))

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock).toHaveBeenCalledWith('openai', 'model-beta', { isEnabled: true })
  })

  it('does not surface local capability filtering as a loading state for larger model sets', async () => {
    const largeModelSet = Array.from({ length: 12 }, (_, index) => ({
      id: `openai::model-${index}`,
      name: `Model ${index}`,
      capabilities: index % 2 === 0 ? ['reasoning'] : ['embedding'],
      isEnabled: true,
      providerId: 'openai'
    })) as any

    useModelsMock.mockReturnValue({ models: largeModelSet, isLoading: false })

    const { result } = renderHook(() => useProviderModelListBrowse({ providerId: 'openai' }))

    expect(result.current.sections.isLoading).toBe(false)

    act(() => {
      result.current.header.setSelectedCapabilityFilter('reasoning')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(6)
    })

    expect(result.current.sections.isLoading).toBe(false)
  })

  it('keeps a newly disabled model in its current group until the provider view remounts', async () => {
    let serverModels = [
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

    useModelsMock.mockImplementation(() => ({ models: serverModels, isLoading: false }))

    const { result, rerender, unmount } = renderHook(() => useProviderModelListBrowse({ providerId: 'openai' }))

    await act(async () => {
      await result.current.sections.onToggleModel(serverModels[0], false)
    })

    expect(result.current.header.enabledModelCount).toBe(0)
    expect(result.current.sections.displayEnabledModelCount).toBe(1)
    expect(result.current.sections.displayDisabledModelCount).toBe(1)
    expect(result.current.sections.enabledSections[0]?.items[0]?.model.id).toBe('openai::reasoning-alpha')
    expect(result.current.sections.enabledSections[0]?.items[0]?.model.isEnabled).toBe(false)
    expect(
      result.current.sections.disabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).not.toContain('openai::reasoning-alpha')

    serverModels = [{ ...serverModels[0], isEnabled: false }, serverModels[1]]

    rerender()

    expect(result.current.sections.enabledSections[0]?.items[0]?.model.id).toBe('openai::reasoning-alpha')
    expect(result.current.sections.enabledSections[0]?.items[0]?.model.isEnabled).toBe(false)

    unmount()

    const { result: remountedResult } = renderHook(() => useProviderModelListBrowse({ providerId: 'openai' }))

    expect(remountedResult.current.sections.enabledSections).toHaveLength(0)
    expect(
      remountedResult.current.sections.disabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toContain('openai::reasoning-alpha')
  })

  it('keeps bulk-disabled visible models in their displayed section until the provider view remounts', async () => {
    let serverModels = [
      {
        id: 'openai::reasoning-alpha',
        name: 'Alpha',
        capabilities: ['reasoning'],
        isEnabled: true,
        providerId: 'openai'
      },
      {
        id: 'openai::reasoning-beta',
        name: 'Beta',
        capabilities: ['reasoning'],
        isEnabled: true,
        providerId: 'openai'
      },
      {
        id: 'openai::embedding-gamma',
        name: 'Gamma',
        capabilities: ['embedding'],
        isEnabled: false,
        providerId: 'openai'
      }
    ] as any

    useModelsMock.mockImplementation(() => ({ models: serverModels, isLoading: false }))

    const { result, rerender, unmount } = renderHook(() => useProviderModelListBrowse({ providerId: 'openai' }))

    await act(async () => {
      await result.current.header.onToggleVisibleModels(false)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(2)
    expect(result.current.header.enabledModelCount).toBe(0)
    expect(result.current.sections.displayEnabledModelCount).toBe(2)
    expect(result.current.sections.displayDisabledModelCount).toBe(1)
    expect(
      result.current.sections.enabledSections
        .flatMap((section) => section.items)
        .map((item) => [item.model.id, item.model.isEnabled] as const)
    ).toEqual([
      ['openai::reasoning-alpha', false],
      ['openai::reasoning-beta', false]
    ])

    serverModels = serverModels.map((model: any) =>
      model.id === 'openai::embedding-gamma' ? model : { ...model, isEnabled: false }
    )

    rerender()

    expect(result.current.sections.displayEnabledModelCount).toBe(2)
    expect(result.current.sections.displayDisabledModelCount).toBe(1)

    unmount()

    const { result: remountedResult } = renderHook(() => useProviderModelListBrowse({ providerId: 'openai' }))

    expect(remountedResult.current.sections.displayEnabledModelCount).toBe(0)
    expect(remountedResult.current.sections.displayDisabledModelCount).toBe(3)
  })
})
