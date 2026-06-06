import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderModelList } from '../useProviderModelList'

const useModelsMock = vi.fn()
const updateModelMock = vi.fn()
const updateModelsMock = vi.fn()

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

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: () => ({
    updateModel: updateModelMock,
    updateModels: updateModelsMock
  })
}))

describe('useProviderModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useModelsMock.mockReturnValue({ models, isLoading: false })
    updateModelMock.mockResolvedValue(undefined)
    updateModelsMock.mockResolvedValue(undefined)
  })

  it('opens local edit drawer state when editing a model', () => {
    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    expect(result.current.editDrawer.open).toBe(false)
    expect(result.current.sections.enabledSections[0]?.items[0]?.model.name).toBe('Alpha')

    act(() => {
      result.current.sections.onEditModel(models[0])
    })

    expect(result.current.editDrawer.open).toBe(true)
    expect(result.current.editDrawer.model?.name).toBe('Alpha')
  })

  it('bulk-enables only the currently visible filtered models', async () => {
    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    act(() => {
      result.current.header.setSearchText('Beta')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(1)
    })

    await act(async () => {
      void result.current.header.onToggleVisibleModels(true)
      await Promise.resolve()
    })

    expect(updateModelsMock).toHaveBeenCalledTimes(1)
    expect(updateModelsMock).toHaveBeenCalledWith([{ uniqueModelId: 'openai::model-beta', patch: { isEnabled: true } }])
    expect(updateModelMock).not.toHaveBeenCalled()
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

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    expect(result.current.sections.isLoading).toBe(false)

    act(() => {
      result.current.header.setSelectedCapabilityFilter('reasoning')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(6)
    })

    expect(result.current.sections.isLoading).toBe(false)
  })

  it('moves a newly disabled model into the disabled section immediately', async () => {
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

    const { result, rerender } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    await act(async () => {
      await result.current.sections.onToggleModel(serverModels[0], false)
    })

    expect(result.current.header.enabledModelCount).toBe(0)
    expect(result.current.sections.displayEnabledModelCount).toBe(0)
    expect(result.current.sections.displayDisabledModelCount).toBe(2)
    expect(result.current.sections.enabledSections).toHaveLength(0)
    expect(
      result.current.sections.disabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toContain('openai::reasoning-alpha')

    serverModels = [{ ...serverModels[0], isEnabled: false }, serverModels[1]]

    rerender()

    expect(result.current.sections.enabledSections).toHaveLength(0)
    expect(
      result.current.sections.disabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toContain('openai::reasoning-alpha')
  })

  it('moves a newly enabled model into the enabled section immediately', async () => {
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

    const { result, rerender } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    await act(async () => {
      await result.current.sections.onToggleModel(serverModels[1], true)
    })

    expect(result.current.header.enabledModelCount).toBe(2)
    expect(result.current.sections.displayEnabledModelCount).toBe(2)
    expect(result.current.sections.displayDisabledModelCount).toBe(0)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toContain('openai::model-beta')

    serverModels = [serverModels[0], { ...serverModels[1], isEnabled: true }]

    rerender()

    expect(result.current.sections.displayEnabledModelCount).toBe(2)
    expect(result.current.sections.displayDisabledModelCount).toBe(0)
  })

  it('moves bulk-disabled visible models into the disabled section immediately', async () => {
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

    const { result, rerender } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    await act(async () => {
      void result.current.header.onToggleVisibleModels(false)
      await Promise.resolve()
    })

    expect(updateModelsMock).toHaveBeenCalledTimes(1)
    expect(updateModelsMock).toHaveBeenCalledWith([
      { uniqueModelId: 'openai::reasoning-alpha', patch: { isEnabled: false } },
      { uniqueModelId: 'openai::reasoning-beta', patch: { isEnabled: false } }
    ])
    expect(updateModelMock).not.toHaveBeenCalled()
    expect(result.current.header.enabledModelCount).toBe(0)
    expect(result.current.sections.displayEnabledModelCount).toBe(0)
    expect(result.current.sections.displayDisabledModelCount).toBe(3)
    expect(
      result.current.sections.disabledSections
        .flatMap((section) => section.items)
        .map((item) => [item.model.id, item.model.isEnabled] as const)
    ).toEqual([
      ['openai::reasoning-alpha', false],
      ['openai::reasoning-beta', false],
      ['openai::embedding-gamma', false]
    ])

    serverModels = serverModels.map((model: any) =>
      model.id === 'openai::embedding-gamma' ? model : { ...model, isEnabled: false }
    )

    rerender()

    expect(result.current.sections.displayEnabledModelCount).toBe(0)
    expect(result.current.sections.displayDisabledModelCount).toBe(3)
  })

  it('bulk-disables only the selected visible model group', async () => {
    const groupedModels = [
      {
        id: 'openai::chat-alpha',
        name: 'Alpha',
        group: 'chat',
        capabilities: ['reasoning'],
        isEnabled: true,
        providerId: 'openai'
      },
      {
        id: 'openai::vision-beta',
        name: 'Beta',
        group: 'vision',
        capabilities: ['reasoning'],
        isEnabled: true,
        providerId: 'openai'
      },
      {
        id: 'openai::chat-gamma',
        name: 'Gamma',
        group: 'chat',
        capabilities: ['embedding'],
        isEnabled: false,
        providerId: 'openai'
      }
    ] as any

    useModelsMock.mockReturnValue({ models: groupedModels, isLoading: false })

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))
    const chatSection = result.current.sections.enabledSections.find((section) => section.groupName === 'chat')

    await act(async () => {
      await result.current.sections.onToggleModels(chatSection?.items.map((item) => item.model) ?? [], false)
    })

    expect(updateModelsMock).toHaveBeenCalledTimes(1)
    expect(updateModelsMock).toHaveBeenCalledWith([
      { uniqueModelId: 'openai::chat-alpha', patch: { isEnabled: false } }
    ])
    expect(result.current.sections.displayEnabledModelCount).toBe(1)
    expect(result.current.sections.displayDisabledModelCount).toBe(2)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toEqual(['openai::vision-beta'])
    expect(
      result.current.sections.disabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toContain('openai::chat-alpha')
  })

  it('bulk-enables only the selected visible model group', async () => {
    const groupedModels = [
      {
        id: 'openai::chat-alpha',
        name: 'Alpha',
        group: 'chat',
        capabilities: ['reasoning'],
        isEnabled: false,
        providerId: 'openai'
      },
      {
        id: 'openai::vision-beta',
        name: 'Beta',
        group: 'vision',
        capabilities: ['reasoning'],
        isEnabled: false,
        providerId: 'openai'
      },
      {
        id: 'openai::chat-gamma',
        name: 'Gamma',
        group: 'chat',
        capabilities: ['embedding'],
        isEnabled: true,
        providerId: 'openai'
      }
    ] as any

    useModelsMock.mockReturnValue({ models: groupedModels, isLoading: false })

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))
    const chatSection = result.current.sections.disabledSections.find((section) => section.groupName === 'chat')

    await act(async () => {
      await result.current.sections.onToggleModels(chatSection?.items.map((item) => item.model) ?? [], true)
    })

    expect(updateModelsMock).toHaveBeenCalledTimes(1)
    expect(updateModelsMock).toHaveBeenCalledWith([{ uniqueModelId: 'openai::chat-alpha', patch: { isEnabled: true } }])
    expect(result.current.sections.displayEnabledModelCount).toBe(2)
    expect(result.current.sections.displayDisabledModelCount).toBe(1)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toContain('openai::chat-alpha')
    expect(
      result.current.sections.disabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toEqual(['openai::vision-beta'])
  })

  it('bulk-toggles only the filtered visible models in a selected group', async () => {
    const groupedModels = [
      {
        id: 'openai::chat-alpha',
        name: 'Alpha',
        group: 'chat',
        capabilities: ['reasoning'],
        isEnabled: true,
        providerId: 'openai'
      },
      {
        id: 'openai::chat-beta',
        name: 'Beta',
        group: 'chat',
        capabilities: ['embedding'],
        isEnabled: true,
        providerId: 'openai'
      },
      {
        id: 'openai::vision-gamma',
        name: 'Gamma',
        group: 'vision',
        capabilities: ['reasoning'],
        isEnabled: true,
        providerId: 'openai'
      }
    ] as any

    useModelsMock.mockReturnValue({ models: groupedModels, isLoading: false })

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    act(() => {
      result.current.header.setSelectedCapabilityFilter('reasoning')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(2)
    })

    const chatSection = result.current.sections.enabledSections.find((section) => section.groupName === 'chat')

    await act(async () => {
      await result.current.sections.onToggleModels(chatSection?.items.map((item) => item.model) ?? [], false)
    })

    expect(updateModelsMock).toHaveBeenCalledTimes(1)
    expect(updateModelsMock).toHaveBeenCalledWith([
      { uniqueModelId: 'openai::chat-alpha', patch: { isEnabled: false } }
    ])
    expect(updateModelsMock).not.toHaveBeenCalledWith([
      { uniqueModelId: 'openai::chat-beta', patch: { isEnabled: false } }
    ])
  })

  it('rolls a failed model toggle back to its original section', async () => {
    useModelsMock.mockReturnValue({ models, isLoading: false })
    updateModelMock.mockRejectedValueOnce(new Error('toggle failed'))

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    await act(async () => {
      await expect(result.current.sections.onToggleModel(models[0], false)).rejects.toThrow('toggle failed')
    })

    expect(result.current.header.enabledModelCount).toBe(1)
    expect(result.current.sections.displayEnabledModelCount).toBe(1)
    expect(result.current.sections.displayDisabledModelCount).toBe(1)
    expect(result.current.sections.enabledSections[0]?.items[0]?.model.id).toBe('openai::reasoning-alpha')
    expect(
      result.current.sections.disabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).not.toContain('openai::reasoning-alpha')
  })
})
