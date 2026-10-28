import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'

import { useTemporaryTopic } from '../useTemporaryTopic'

describe('useTemporaryTopic', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    vi.clearAllMocks()
    vi.mocked(dataApiService.post).mockImplementation(async (path) => {
      if (path === '/temporary/topics') return { id: 'temp-topic-1' } as never
      if (path === '/temporary/topics/temp-topic-1/persist') return undefined as never
      throw new Error(`Unexpected POST ${path}`)
    })
  })

  /** Lease ids in creation order, and a save whose outcome the test decides. */
  const stubLeasesWithPendingSave = () => {
    let created = 0
    let rejectSave: (error: Error) => void = () => {}
    vi.mocked(dataApiService.post).mockImplementation(async (path) => {
      if (path === '/temporary/topics') return { id: `temp-topic-${++created}` } as never
      if (path === '/temporary/topics/temp-topic-1/persist') {
        return new Promise((_, reject) => {
          rejectSave = reject
        }) as never
      }
      throw new Error(`Unexpected POST ${path}`)
    })
    return { failSave: (error: Error) => rejectSave(error) }
  }
  const deletedTopics = () => vi.mocked(dataApiService.delete).mock.calls.map(([path]) => path)

  it('releases a conversation abandoned mid-save once that save fails', async () => {
    const save = stubLeasesWithPendingSave()
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true }))
    await waitFor(() => expect(result.current.topicId).toBe('temp-topic-1'))

    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = result.current.persist().catch(() => undefined)
    })
    // The user starts over while the save is in flight; cleanup must not delete what is being saved.
    act(() => result.current.reset())
    await waitFor(() => expect(result.current.topicId).toBe('temp-topic-2'))
    expect(deletedTopics()).not.toContain('/temporary/topics/temp-topic-1')

    await act(async () => {
      save.failSave(new Error('disk full'))
      await saving
    })

    // Main restores the topic on a failed persist; with no lease left, only this can free it.
    expect(deletedTopics()).toContain('/temporary/topics/temp-topic-1')
  })

  it('keeps the active conversation when its save fails, so the save can be retried', async () => {
    const save = stubLeasesWithPendingSave()
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true }))
    await waitFor(() => expect(result.current.topicId).toBe('temp-topic-1'))

    let failure: unknown
    await act(async () => {
      const saving = result.current.persist().catch((error: unknown) => {
        failure = error
      })
      save.failSave(new Error('disk full'))
      await saving
    })

    expect(failure).toBeInstanceOf(Error)
    expect(deletedTopics()).not.toContain('/temporary/topics/temp-topic-1')
    expect(result.current.topicId).toBe('temp-topic-1')
  })

  it('persists a seeded placeholder name as an automatic topic name', async () => {
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true }))

    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.persist(' Temporary title ')
    })

    expect(dataApiService.patch).toHaveBeenCalledWith('/topics/temp-topic-1', {
      body: {
        name: 'Temporary title',
        isNameManuallyEdited: false
      }
    })
  })

  it('does not persist a lone surrogate when the placeholder name cut lands inside an emoji', async () => {
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true }))

    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.persist('字'.repeat(29) + '😀' + '文'.repeat(10))
    })

    expect(dataApiService.patch).toHaveBeenCalledWith('/topics/temp-topic-1', {
      body: {
        name: '字'.repeat(29),
        isNameManuallyEdited: false
      }
    })
  })
})
