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

vi.mock('../modelListHealthContext', () => ({
  useModelListHealth: () => ({
    isHealthChecking: false,
    modelStatusMap: new Map([['openai::reasoning-alpha', { status: 'success', checking: false, keyResults: [] }]])
  })
}))

describe('useProviderModelListBrowse', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useModelsMock.mockReturnValue({ models })
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

    await act(async () => {
      await result.current.header.onToggleVisibleModels(true)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)
    expect(updateModelMock).toHaveBeenCalledWith('openai', 'model-beta', { isEnabled: true })
  })
})
