import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderModelList } from '../useProviderModelList'

const useModelsMock = vi.fn()
const deleteModelMock = vi.fn()
const deleteModelsMock = vi.fn()

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
    deleteModel: deleteModelMock,
    deleteModels: deleteModelsMock
  })
}))

describe('useProviderModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useModelsMock.mockReturnValue({ models, isLoading: false })
    deleteModelMock.mockResolvedValue(undefined)
    deleteModelsMock.mockResolvedValue(undefined)
  })

  it('opens local edit drawer state when editing a model', () => {
    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    expect(result.current.editDrawer.open).toBe(false)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.name)
    ).toContain('Alpha')

    act(() => {
      result.current.sections.onEditModel(models[0])
    })

    expect(result.current.editDrawer.open).toBe(true)
    expect(result.current.editDrawer.model?.name).toBe('Alpha')
  })

  it('does not surface local search filtering as a loading state for larger model sets', async () => {
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
      result.current.header.setSearchText('Model 1')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(3)
    })

    expect(result.current.sections.isLoading).toBe(false)
  })

  it('deletes a model and removes it from the list immediately', async () => {
    let resolveDelete!: () => void
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve
    })

    useModelsMock.mockReturnValue({ models, isLoading: false })
    deleteModelMock.mockReturnValueOnce(deletePromise)

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))
    let deleteTask!: Promise<void>

    act(() => {
      deleteTask = result.current.sections.onDeleteModel(models[1])
    })

    expect(deleteModelMock).toHaveBeenCalledWith('openai', 'model-beta')
    expect(result.current.sections.pendingModelIds.has('openai::model-beta')).toBe(true)
    expect(result.current.header.modelCount).toBe(1)
    expect(result.current.sections.displayEnabledModelCount).toBe(1)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toEqual(['openai::reasoning-alpha'])

    await act(async () => {
      resolveDelete()
      await deleteTask
    })

    expect(result.current.sections.pendingModelIds.has('openai::model-beta')).toBe(false)
  })

  it('rolls a failed model delete back to the unified model list', async () => {
    const error = new Error('delete failed')
    let rejectDelete!: (reason?: unknown) => void
    const deletePromise = new Promise<void>((_, reject) => {
      rejectDelete = reject
    })

    useModelsMock.mockReturnValue({ models, isLoading: false })
    deleteModelMock.mockReturnValueOnce(deletePromise)

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))
    let deleteTask!: Promise<void>

    act(() => {
      deleteTask = result.current.sections.onDeleteModel(models[1])
    })

    expect(deleteModelMock).toHaveBeenCalledWith('openai', 'model-beta')
    expect(result.current.sections.pendingModelIds.has('openai::model-beta')).toBe(true)
    expect(result.current.header.modelCount).toBe(1)

    await act(async () => {
      rejectDelete(error)
      await expect(deleteTask).rejects.toThrow('delete failed')
    })

    expect(result.current.sections.pendingModelIds.has('openai::model-beta')).toBe(false)
    expect(result.current.header.modelCount).toBe(2)
    expect(result.current.sections.displayEnabledModelCount).toBe(2)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toContain('openai::model-beta')
  })

  it('deletes all selected group models and removes them immediately', async () => {
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
    const chatSection = result.current.sections.enabledSections.find((section) => section.groupName === 'chat')

    await act(async () => {
      await result.current.sections.onDeleteModels(chatSection?.items.map((item) => item.model) ?? [])
    })

    expect(deleteModelsMock).toHaveBeenCalledTimes(1)
    expect(deleteModelsMock).toHaveBeenCalledWith(['openai::chat-alpha', 'openai::chat-beta'])
    expect(deleteModelMock).not.toHaveBeenCalled()
    expect(result.current.header.modelCount).toBe(1)
    expect(result.current.sections.displayEnabledModelCount).toBe(1)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toEqual(['openai::vision-gamma'])
  })

  it('deletes only the searched visible models in a selected group', async () => {
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
      result.current.header.setSearchText('Beta')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(1)
    })

    const chatSection = result.current.sections.enabledSections.find((section) => section.groupName === 'chat')

    await act(async () => {
      await result.current.sections.onDeleteModels(chatSection?.items.map((item) => item.model) ?? [])
    })

    expect(deleteModelsMock).toHaveBeenCalledTimes(1)
    expect(deleteModelsMock).toHaveBeenCalledWith(['openai::chat-beta'])

    act(() => {
      result.current.header.setSearchText('')
    })

    await waitFor(() => {
      expect(result.current.header.modelCount).toBe(2)
    })
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toEqual(['openai::chat-alpha', 'openai::vision-gamma'])
  })

  it('rolls back all group models when the batch delete fails', async () => {
    const error = new Error('delete group failed')
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
      }
    ] as any

    deleteModelsMock.mockRejectedValueOnce(error)
    useModelsMock.mockReturnValue({ models: groupedModels, isLoading: false })

    const { result } = renderHook(() => useProviderModelList({ providerId: 'openai' }))

    await act(async () => {
      await expect(result.current.sections.onDeleteModels(groupedModels)).rejects.toThrow('delete group failed')
    })

    expect(deleteModelsMock).toHaveBeenCalledWith(['openai::chat-alpha', 'openai::chat-beta'])
    expect(deleteModelMock).not.toHaveBeenCalled()
    expect(result.current.header.modelCount).toBe(2)
    expect(
      result.current.sections.enabledSections.flatMap((section) => section.items).map((item) => item.model.id)
    ).toEqual(['openai::chat-alpha', 'openai::chat-beta'])
  })
})
