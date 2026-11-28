import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { ipcApi, useIpcOn } from '@renderer/ipc'

import { useLocalAgentVersion } from '../useLocalAgentVersion'

vi.unmock('@data/hooks/useCache')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))

const installed = { current: '1.0.0', canUpgrade: false }
const available = { ...installed, latest: '2.0.0', canUpgrade: true }

beforeEach(() => {
  MockCacheUtils.resetMocks()
  vi.mocked(ipcApi.request).mockReset()
  vi.mocked(useIpcOn).mockClear()
})

it('shows cached upgrades immediately on remount without hiding them during a background version check', async () => {
  vi.mocked(ipcApi.request).mockResolvedValueOnce(installed).mockResolvedValueOnce(available)
  const initial = renderHook(() => useLocalAgentVersion('kilo', '/bin/kilo'))
  await waitFor(() => expect(initial.result.current).toMatchObject(available))
  initial.unmount()

  let finish!: (value: typeof available) => void
  vi.mocked(ipcApi.request)
    .mockResolvedValueOnce(installed)
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  const next = renderHook(() => useLocalAgentVersion('kilo', '/bin/kilo'))
  expect(next.result.current).toMatchObject(available)
  await waitFor(() => expect(finish).toBeDefined())
  expect(next.result.current).toMatchObject(available)
  await act(async () => finish({ ...available, latest: '3.0.0' }))
  expect(next.result.current).toMatchObject({ latest: '3.0.0', canUpgrade: true })
  next.unmount()

  vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('offline'))
  const offline = renderHook(() => useLocalAgentVersion('kilo', '/bin/kilo'))
  await act(async () => {})
  expect(offline.result.current).toMatchObject({ latest: '3.0.0', canUpgrade: true })
})

it('clears an obsolete upgrade when installation changes, before the new latest-version request completes', async () => {
  vi.mocked(ipcApi.request).mockResolvedValueOnce(installed).mockResolvedValueOnce(available)
  const { result } = renderHook(() => useLocalAgentVersion('kilo', '/bin/kilo'))
  await waitFor(() => expect(result.current).toMatchObject(available))

  let finish!: (value: typeof installed) => void
  vi.mocked(ipcApi.request)
    .mockResolvedValueOnce({ current: '2.0.0', canUpgrade: false })
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  act(() => {
    const listener = vi.mocked(useIpcOn).mock.calls.at(-1)![1]
    listener({})
  })
  await waitFor(() => expect(result.current).toMatchObject({ current: '2.0.0', canUpgrade: false }))
  expect(result.current?.latest).toBeUndefined()
  await act(async () => finish({ current: '2.0.0', canUpgrade: false }))
  expect(result.current).toMatchObject({ current: '2.0.0', canUpgrade: false })
})

it('separates executable paths and ignores a late response from the previous installation', async () => {
  let finishOld!: (value: typeof available) => void
  vi.mocked(ipcApi.request)
    .mockResolvedValueOnce(installed)
    .mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)))
  const { result, rerender } = renderHook(({ path }) => useLocalAgentVersion('kilo', path), {
    initialProps: { path: '/old/kilo' }
  })
  await waitFor(() => expect(finishOld).toBeDefined())

  vi.mocked(ipcApi.request)
    .mockResolvedValueOnce({ current: '3.0.0', canUpgrade: false })
    .mockResolvedValueOnce({ current: '3.0.0', latest: '3.0.0', canUpgrade: false })
  rerender({ path: '/new/kilo' })
  expect(result.current).toBeUndefined()
  await waitFor(() => expect(result.current?.latest).toBe('3.0.0'))
  await act(async () => finishOld(available))
  expect(result.current).toMatchObject({ current: '3.0.0', canUpgrade: false })
})
