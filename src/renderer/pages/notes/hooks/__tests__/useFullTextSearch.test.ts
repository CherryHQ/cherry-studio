import type { NotesSearchResult, NotesTreeNode } from '@shared/types/note'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipcRequest = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest } }))

import { useFullTextSearch } from '../useFullTextSearch'

const node: NotesTreeNode = {
  id: 'note-1',
  name: 'Note',
  type: 'file',
  treePath: 'Note.md',
  externalPath: '/notes/Note.md',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z'
}

function result(id: string): NotesSearchResult {
  return {
    ...node,
    id,
    name: id,
    matchType: 'content',
    matches: [],
    score: 10
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useFullTextSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ipcRequest.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the notes tree through one search request and uses the main-process result limit', async () => {
    ipcRequest.mockResolvedValue([result('match')])
    const { result: hook } = renderHook(() =>
      useFullTextSearch({ debounceMs: 0, maxResults: 7, caseSensitive: true, contextLength: 20 })
    )

    act(() => hook.current.search([node], '  needle  '))
    await act(async () => vi.runAllTimersAsync())

    expect(hook.current.results.map(({ id }) => id)).toEqual(['match'])
    expect(ipcRequest).toHaveBeenCalledOnce()
    expect(ipcRequest).toHaveBeenCalledWith('notes.full_text.search', {
      requestId: expect.any(String),
      nodes: [node],
      keyword: 'needle',
      options: { caseSensitive: true, contextLength: 20 },
      maxResults: 7
    })
    expect(hook.current.stats).toEqual({ total: 1, fileNameMatches: 0, contentMatches: 1, bothMatches: 0 })
  })

  it('treats a whitespace-only keyword as an empty search without sending IPC', async () => {
    const { result: hook } = renderHook(() => useFullTextSearch({ debounceMs: 0 }))

    act(() => hook.current.search([node], '   '))
    await act(async () => vi.runAllTimersAsync())

    expect(ipcRequest).not.toHaveBeenCalled()
    expect(hook.current.results).toEqual([])
    expect(hook.current.isSearching).toBe(false)
  })

  it('cancels a superseded main-process search and ignores its stale result', async () => {
    const first = createDeferred<NotesSearchResult[]>()
    let searchCount = 0
    ipcRequest.mockImplementation((route: string) => {
      if (route === 'notes.full_text.cancel') return Promise.resolve()
      searchCount += 1
      return searchCount === 1 ? first.promise : Promise.resolve([result('second')])
    })
    const { result: hook } = renderHook(() => useFullTextSearch({ debounceMs: 0 }))

    act(() => hook.current.search([node], 'first'))
    await act(async () => vi.runAllTimersAsync())
    expect(ipcRequest.mock.calls.filter(([route]) => route === 'notes.full_text.search')).toHaveLength(1)
    const firstRequestId = ipcRequest.mock.calls.find(([route]) => route === 'notes.full_text.search')?.[1].requestId

    act(() => hook.current.search([node], 'second'))
    await act(async () => vi.runAllTimersAsync())

    expect(hook.current.results.map(({ id }) => id)).toEqual(['second'])
    expect(ipcRequest).toHaveBeenCalledWith('notes.full_text.cancel', { requestId: firstRequestId })

    await act(async () => first.resolve([result('first')]))
    expect(hook.current.results.map(({ id }) => id)).toEqual(['second'])
  })

  it('cancels an active main-process search when the hook unmounts', async () => {
    const pending = createDeferred<NotesSearchResult[]>()
    ipcRequest.mockImplementation((route: string) =>
      route === 'notes.full_text.cancel' ? Promise.resolve() : pending.promise
    )
    const { result: hook, unmount } = renderHook(() => useFullTextSearch({ debounceMs: 0 }))

    act(() => hook.current.search([node], 'needle'))
    await act(async () => vi.runAllTimersAsync())
    const requestId = ipcRequest.mock.calls.find(([route]) => route === 'notes.full_text.search')?.[1].requestId

    unmount()
    expect(ipcRequest).toHaveBeenCalledWith('notes.full_text.cancel', { requestId })
    pending.resolve([])
  })
})
