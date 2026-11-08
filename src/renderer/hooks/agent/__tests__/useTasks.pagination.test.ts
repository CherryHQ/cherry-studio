import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'

import { useAllTasks } from '../useTasks'

vi.unmock('@data/hooks/useDataApi')

afterEach(() => vi.restoreAllMocks())

const statuses: NonNullable<Parameters<typeof useAllTasks>[0]>[] = [
  'active',
  'paused',
  'completed',
  'missed',
  ['paused', 'missed']
]
const cases = statuses.map((status) => [status] as const)
it.each(cases)('revisits the last %j page after shrinking and growing', async (status) => {
  let total = 51
  let releasePage: (() => void) | undefined
  let delayPage = false
  vi.spyOn(dataApiService, 'get').mockImplementation((async (
    _path: string,
    options: { query?: { page?: number } } = {}
  ) => {
    const page = options.query?.page ?? 1
    if (page === 2 && delayPage) await new Promise<void>((resolve) => (releasePage = resolve))
    return { items: page === 2 && total === 51 ? [{ id: 'last-task' }] : [], total, page, limit: 50 }
  }) as never)
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(() => useAllTasks(status), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.total).toBe(51))
  act(() => result.current.nextPage())
  await waitFor(() => expect(result.current.tasks).toEqual([{ id: 'last-task' }]))

  total = 50
  await act(async () => {
    await result.current.refetch()
  })
  await waitFor(() => expect(result.current.page).toBe(1))
  total = 51
  await act(async () => {
    await result.current.refetch()
  })
  await waitFor(() => expect(result.current.hasNext).toBe(true))

  delayPage = true
  act(() => result.current.nextPage())
  await waitFor(() => expect(releasePage).toBeDefined())
  expect(result.current.page).toBe(2)
  await act(async () => releasePage!())
  await waitFor(() => expect(result.current.tasks).toEqual([{ id: 'last-task' }]))
  expect(result.current.page).toBe(2)
})
