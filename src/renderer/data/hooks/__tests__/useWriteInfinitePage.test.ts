import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { unstable_serialize, useSWRConfig } from 'swr'
import { unstable_serialize as serializeInfinite } from 'swr/infinite'
import { expect, it, vi } from 'vitest'

import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { CherryUIMessage } from '@shared/data/types/message'

import { useInfiniteQuery, useWriteInfiniteCache, useWriteInfinitePage } from '../useDataApi'
import { createSWRTestWrapper } from './testUtils'

vi.unmock('@data/hooks/useDataApi')

const path = '/agent-sessions/:sessionId/children/:toolCallId/history'
const options = (sessionId: string) => ({
  params: { sessionId, toolCallId: 'tool' },
  query: { before: 'start' },
  limit: 50
})
const readKey = (sessionId: string, index: number) => [
  `/agent-sessions/${sessionId}/children/tool/history`,
  { before: 'start', limit: 50, ...(index > 0 && { cursor: String(index) }) }
]
const message = (id: string): CherryUIMessage => ({ id, role: 'assistant', parts: [] })
type Page = CursorPaginationResponse<CherryUIMessage>

it.each([20, 20_000])('updates two rows on one page of %i messages without writing other pages', async (count) => {
  const { Wrapper, cache } = createSWRTestWrapper()
  const { result } = renderHook(
    () => ({
      seed: useWriteInfiniteCache(path, options('a')),
      write: useWriteInfinitePage(path, options('a'))
    }),
    { wrapper: Wrapper }
  )
  const pages: Page[] = Array.from({ length: Math.ceil(count / 50) }, (_, i) => ({
    items: Array.from({ length: Math.min(50, count - i * 50) }, (_, j) => message(`${i}.${j}`)),
    nextCursor: String(i + 1)
  }))
  await act(() => result.current.seed(pages))
  const writes = vi.spyOn(cache, 'set')
  const index = pages.length - 1
  const update = (slot: number) => (page: Page) => {
    const items = page.items.slice()
    items[slot] = { ...items[slot], parts: [{ type: 'text', text: 'saved' }] }
    return items
  }
  await act(() => Promise.all([result.current.write(index, update(0)), result.current.write(index, update(1))]))
  const group = serializeInfinite(() => readKey('a', 0))
  const pageKey = unstable_serialize(readKey('a', index))
  const committed = cache.get(group)?.data as Page[]
  expect(committed[index].items.slice(0, 2).map((row) => row.parts)).toEqual([
    [{ type: 'text', text: 'saved' }],
    [{ type: 'text', text: 'saved' }]
  ])
  expect(cache.get(pageKey)?.data).toBe(committed[index])
  expect(new Set(writes.mock.calls.map(([key]) => key))).toEqual(new Set([group, pageKey]))
})

it('keeps late reads scoped to their query and gives the updater the current page after a replacement', async () => {
  const { Wrapper, cache } = createSWRTestWrapper()
  const { result, rerender } = renderHook(
    ({ scope }) => ({
      seed: useWriteInfiniteCache(path, options(scope)),
      write: useWriteInfinitePage(path, options(scope))
    }),
    { wrapper: Wrapper, initialProps: { scope: 'a' } }
  )
  const previous = message('reply')
  await act(() => result.current.seed([{ items: [previous] }]))
  const writeA = result.current.write
  rerender({ scope: 'b' })
  const current = message('same-local-id')
  await act(() => result.current.seed([{ items: [current] }]))
  const edited = { ...previous, parts: [{ type: 'text' as const, text: 'edited' }] }
  await act(() => writeA(0, () => [edited]))
  await act(() => writeA(0, (page) => (page.items[0] === previous ? [message('late')] : page.items)))
  const pageA = cache.get(unstable_serialize(readKey('a', 0)))?.data as Page
  const pageB = cache.get(unstable_serialize(readKey('b', 0)))?.data as Page
  expect(pageA.items[0]).toBe(edited)
  expect(pageB.items[0]).toBe(current)
})

it('preserves a concurrent branch refresh when a saved row from the old branch arrives', async () => {
  const oldRow = message('old')
  mockDataApiService.get.mockResolvedValue({ items: [oldRow] })
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(
    () => ({
      history: useInfiniteQuery(path, options('a')),
      write: useWriteInfinitePage(path, options('a'))
    }),
    { wrapper: Wrapper }
  )
  await waitFor(() => expect(result.current.history.pages[0]?.items[0]).toBe(oldRow))
  const branch = Promise.withResolvers<Page>()
  mockDataApiService.get.mockReturnValueOnce(branch.promise)
  act(() => {
    void result.current.history.refresh()
  })
  await waitFor(() => expect(result.current.history.isRefreshing).toBe(true))
  await act(async () => {
    const completing = result.current.write(0, (page) =>
      page.items[0] === oldRow ? [message('old-completed')] : page.items
    )
    branch.resolve({ items: [message('selected-branch')] })
    await completing
  })
  expect(result.current.history.pages[0].items.map((row) => row.id)).toEqual(['selected-branch'])
})

it('preserves a membership read failure when a waiting row write succeeds', async () => {
  mockDataApiService.get.mockResolvedValue({ items: [message('old')] })
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(
    () => ({ history: useInfiniteQuery(path, options('a')), write: useWriteInfinitePage(path, options('a')) }),
    { wrapper: Wrapper }
  )
  await waitFor(() => expect(result.current.history.pages).toHaveLength(1))
  const membership = Promise.withResolvers<Page>()
  const offline = new Error('membership unavailable')
  mockDataApiService.get.mockReturnValueOnce(membership.promise)
  let read!: Promise<unknown>
  act(() => {
    read = result.current.history.refresh({ throwOnError: true }).catch((error) => error)
  })
  await waitFor(() => expect(result.current.history.isRefreshing).toBe(true))
  await act(async () => {
    const write = result.current.write(0, () => [message('committed')])
    membership.reject(offline)
    await write
  })
  expect(await read).toBe(offline)
  expect(result.current.history.error).toBe(offline)
  expect(result.current.history.pages[0].items[0].id).toBe('committed')
})

it('releases a row write waiting for an unmounted history reader', async () => {
  mockDataApiService.get.mockResolvedValue({ items: [message('old')] })
  const { Wrapper, cache } = createSWRTestWrapper()
  const hook = renderHook(
    () => ({
      history: useInfiniteQuery(path, options('a')),
      write: useWriteInfinitePage(path, options('a'))
    }),
    { wrapper: Wrapper }
  )
  await waitFor(() => expect(hook.result.current.history.pages).toHaveLength(1))
  const membership = Promise.withResolvers<Page>()
  mockDataApiService.get.mockReturnValueOnce(membership.promise)
  act(() => {
    void hook.result.current.history.refresh()
  })
  await waitFor(() => expect(hook.result.current.history.isRefreshing).toBe(true))
  const write = hook.result.current.write(0, () => [message('late reply')])
  hook.unmount()
  await write
  expect(cache.get(unstable_serialize(readKey('a', 0)))?.data).toMatchObject({ items: [{ id: 'old' }] })
  membership.resolve({ items: [] })
})

it('returns the failed read to its caller even after an independent cache update recovers the list', async () => {
  const page = { items: [message('old')] }
  const recovered = { items: [message('new')] }
  mockDataApiService.get.mockResolvedValue(page)
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(
    () => {
      const { mutate } = useSWRConfig()
      return useInfiniteQuery(path, {
        ...options('a'),
        swrOptions: {
          shouldRetryOnError: false,
          onError: () =>
            queueMicrotask(
              () =>
                void mutate(
                  serializeInfinite(() => readKey('a', 0)),
                  [recovered],
                  false
                )
            )
        }
      })
    },
    { wrapper: Wrapper }
  )
  await waitFor(() => expect(result.current.pages).toEqual([page]))
  mockDataApiService.get.mockRejectedValueOnce(new Error('offline'))
  await act(async () => {
    await expect(result.current.refresh({ throwOnError: true })).rejects.toThrow('offline')
  })
  expect(result.current.pages).toEqual([recovered])
  expect(result.current.error).toBeUndefined()
})

it('keeps the outcome of each reader when a newer refresh finishes first', async () => {
  const oldPage = { items: [message('old')] }
  const newPage = { items: [message('new')] }
  mockDataApiService.get.mockResolvedValue(oldPage)
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(
    () => ({
      first: useInfiniteQuery(path, options('a')),
      second: useInfiniteQuery(path, options('a'))
    }),
    { wrapper: Wrapper }
  )
  await waitFor(() => expect(result.current.first.pages).toEqual([oldPage]))
  const older = Promise.withResolvers<Page>()
  mockDataApiService.get.mockReturnValueOnce(older.promise).mockResolvedValueOnce(newPage)
  let first!: Promise<unknown>
  await act(async () => {
    first = result.current.first.refresh({ throwOnError: true }).catch((error) => error)
    await expect(result.current.second.refresh({ throwOnError: true })).resolves.toEqual([newPage])
  })
  const offline = new Error('older request failed')
  await act(async () => {
    older.reject(offline)
    expect(await first).toBe(offline)
  })
  expect(result.current.second.pages).toEqual([newPage])
})

it('checks each selected cursor and follows the new end of the branch when it shrinks', async () => {
  const head = { items: [message('head')], nextCursor: 'older' }
  const tail = { items: [message('tail')] }
  mockDataApiService.get.mockImplementation(async (_path, options) => (options?.query?.cursor ? tail : head))
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(() => useInfiniteQuery(path, options('a')), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.pages).toEqual([head]))
  act(() => result.current.loadNext())
  await waitFor(() => expect(result.current.pages).toEqual([head, tail]))
  const offline = new Error('second page offline')
  mockDataApiService.get.mockResolvedValueOnce(head).mockRejectedValueOnce(offline)
  await act(async () => {
    await expect(result.current.refresh({ throwOnError: true })).rejects.toBe(offline)
  })
  expect(result.current.pages).toEqual([head, tail])
  const empty = { items: [] }
  mockDataApiService.get.mockResolvedValueOnce(empty)
  await act(async () => {
    await expect(result.current.refresh({ throwOnError: true })).resolves.toEqual([empty])
  })
  expect(result.current.pages).toEqual([empty])
})

it('releases a strict read when its query changes and rejects a refresh with no active reader', async () => {
  const page = { items: [message('old')] }
  mockDataApiService.get.mockResolvedValue(page)
  const { Wrapper } = createSWRTestWrapper()
  const hook = renderHook(({ scope, enabled }) => useInfiniteQuery(path, { ...options(scope), enabled }), {
    wrapper: Wrapper,
    initialProps: { scope: 'a', enabled: true }
  })
  await waitFor(() => expect(hook.result.current.pages).toEqual([page]))
  const pending = Promise.withResolvers<Page>()
  mockDataApiService.get.mockReturnValueOnce(pending.promise)
  let first!: Promise<unknown>
  act(() => {
    first = hook.result.current.refresh({ throwOnError: true }).catch((error) => error)
  })
  await waitFor(() => expect(hook.result.current.isRefreshing).toBe(true))
  hook.rerender({ scope: 'b', enabled: false })
  expect(await first).toBeInstanceOf(Error)
  await expect(hook.result.current.refresh({ throwOnError: true })).rejects.toThrow()
  pending.resolve(page)
})
