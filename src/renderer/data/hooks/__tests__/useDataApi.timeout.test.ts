import type { DataRequest, DataResponse } from '@shared/data/api/types'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from './testUtils'

vi.unmock('@data/DataApiService')
vi.unmock('@data/hooks/useDataApi')

import { useQuery } from '../useDataApi'

const request = vi.fn<(request: DataRequest) => Promise<DataResponse>>()

beforeEach(() => {
  vi.useFakeTimers()
  request.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { dataApi: { request } }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useQuery delayed local IPC recovery', () => {
  it('leaves loading with ordered data when a local topic read exceeds three seconds', async () => {
    const data = { items: [{ id: 'first' }, { id: 'second' }], nextCursor: null }
    request.mockImplementation(
      (req) => new Promise((resolve) => setTimeout(() => resolve({ id: req.id, status: 200, data }), 3500))
    )
    const { Wrapper } = createSWRTestWrapper()
    const { result } = renderHook(() => useQuery('/topics'), { wrapper: Wrapper })

    expect(result.current.isLoading).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(3500))
    expect(result.current).toMatchObject({ data, isLoading: false, isRefreshing: false, error: undefined })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('leaves loading on a stalled read and clears the error after an explicit successful refresh', async () => {
    request.mockImplementationOnce(() => new Promise(() => {}))
    const { Wrapper } = createSWRTestWrapper()
    const { result } = renderHook(() => useQuery('/topics'), { wrapper: Wrapper })

    await act(() => vi.advanceTimersByTimeAsync(12000))
    expect(result.current).toMatchObject({ isLoading: false, isRefreshing: false, error: { code: 'TIMEOUT' } })
    expect(request).toHaveBeenCalledTimes(1)

    request.mockImplementationOnce(async (req) => ({ id: req.id, status: 200, data: { items: [], nextCursor: null } }))
    await act(async () => {
      await result.current.refetch()
    })
    expect(result.current).toMatchObject({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isRefreshing: false,
      error: undefined
    })
  })
})
