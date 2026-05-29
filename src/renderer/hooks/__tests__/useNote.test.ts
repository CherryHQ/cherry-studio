import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNote } from '../useNote'

describe('useNote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/notes', [])
  })

  it('rethrows patchNode mutation failures', async () => {
    const error = new Error('patch failed')
    const trigger = vi.fn().mockRejectedValue(error)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/notes', trigger)

    const { result } = renderHook(() => useNote(' C:\\Users\\test\\Notes '))

    await expect(
      result.current.patchNode({ externalPath: 'C:\\Users\\test\\Notes\\a.md', type: 'file' }, { isStarred: true })
    ).rejects.toThrow('patch failed')

    expect(trigger).toHaveBeenCalledWith({
      body: {
        rootPath: 'C:/Users/test/Notes',
        path: 'C:/Users/test/Notes/a.md',
        isStarred: true
      }
    })
  })

  it('returns note metadata map without derived duplicate views', () => {
    MockUseDataApiUtils.mockQueryData('/notes', [
      {
        id: 'note-1',
        rootPath: '/notes',
        path: '/notes/a.md',
        isStarred: true,
        isExpanded: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ])

    const { result } = renderHook(() => useNote('/notes'))

    expect(result.current.noteByPath.get('/notes/a.md')).toMatchObject({ isStarred: true })
    expect(result.current).not.toHaveProperty('starredPaths')
    expect(result.current).not.toHaveProperty('expandedPaths')
    expect(result.current).not.toHaveProperty('isLoading')
    expect(result.current).not.toHaveProperty('refetch')
  })

  it('skips hint nodes without mutating metadata', async () => {
    const trigger = vi.fn().mockResolvedValue(null)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/notes', trigger)

    const { result } = renderHook(() => useNote('/notes'))

    await act(async () => {
      await result.current.patchNode({ externalPath: '/notes/hint', type: 'hint' }, { isStarred: true })
    })

    expect(trigger).not.toHaveBeenCalled()
  })
})
