import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { unstable_serialize } from 'swr'
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
