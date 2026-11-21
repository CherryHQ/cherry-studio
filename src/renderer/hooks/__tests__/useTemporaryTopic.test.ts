import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'

import { useTemporaryTopic } from '../useTemporaryTopic'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

describe('useTemporaryTopic', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    vi.clearAllMocks()
    vi.mocked(ipcApi.request).mockImplementation(async (route: string) => {
      if (route === 'ai.temporary_topic.create') return { id: 'temp-topic-1' } as never
      if (route === 'ai.temporary_topic.persist') return undefined as never
      throw new Error(`Unexpected request ${route}`)
    })
  })

  it('hides the previous assistant topic until the replacement lease is ready', async () => {
    let next!: (value: never) => void
    vi.mocked(ipcApi.request).mockImplementation(async (route: string, args: any) => {
      if (route === 'ai.temporary_topic.create')
        return args.assistantId === 'first'
          ? ({ id: 'temp-first' } as never)
          : await new Promise<never>((resolve) => {
              next = resolve
            })
      return undefined as never
    })
    const renders: Array<{ assistantId: string; topicId: string | null }> = []
    const { result, rerender } = renderHook(
      ({ assistantId }) => {
        const topic = useTemporaryTopic({ enabled: true, assistantId })
        renders.push({ assistantId, topicId: topic.topicId })
        return topic
      },
      { initialProps: { assistantId: 'first' } }
    )
    await waitFor(() => expect(result.current.topicId).toBe('temp-first'))
    rerender({ assistantId: 'second' })
    expect(
      renders.filter((render) => render.assistantId === 'second').every((render) => render.topicId !== 'temp-first')
    ).toBe(true)
    expect(result.current.topicId).toBeNull()
    expect(result.current.ready).toBe(false)
    await act(async () => next({ id: 'temp-second' } as never))
    expect(result.current.topicId).toBe('temp-second')
    expect(ipcApi.request).toHaveBeenCalledWith('ai.temporary_topic.delete', { id: 'temp-first' })
  })

  it('a late obsolete lease cannot replace or steal cleanup ownership from the active lease', async () => {
    let old!: (value: never) => void
    vi.mocked(ipcApi.request).mockImplementation(async (route: string, args: any) => {
      if (route === 'ai.temporary_topic.create')
        return args.assistantId === 'first'
          ? await new Promise<never>((resolve) => {
              old = resolve
            })
          : ({ id: 'temp-second' } as never)
      return undefined as never
    })
    const { result, rerender, unmount } = renderHook(
      ({ assistantId }) => useTemporaryTopic({ enabled: true, assistantId }),
      { initialProps: { assistantId: 'first' } }
    )
    rerender({ assistantId: 'second' })
    await waitFor(() => expect(result.current.topicId).toBe('temp-second'))
    await act(async () => old({ id: 'temp-first' } as never))
    expect(result.current.topicId).toBe('temp-second')
    unmount()
    expect(ipcApi.request).toHaveBeenCalledWith('ai.temporary_topic.delete', { id: 'temp-first' })
    expect(ipcApi.request).toHaveBeenCalledWith('ai.temporary_topic.delete', { id: 'temp-second' })
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
