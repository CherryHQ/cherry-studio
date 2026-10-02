import { webcrypto } from 'node:crypto'

import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { ipcApi } from '@renderer/ipc'
import {
  LocalAgentConfigurationSchema,
  type LocalAgentConfiguration,
  type LocalAgentModelCatalog
} from '@shared/ai/localAgent'

import { useLocalAgentModelCatalog } from '../useLocalAgentModelCatalog'

vi.unmock('@data/hooks/useCache')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const config: LocalAgentConfiguration = { protocol: 'acp', enabled: true, args: [], env: { API_KEY: 'secret-value' } }
const first = { models: [{ id: 'first', name: 'First' }] }
const second = { models: [{ id: 'second', name: 'Second' }] }

beforeEach(() => {
  MockCacheUtils.resetMocks()
  vi.mocked(ipcApi.request).mockReset()
  vi.stubGlobal('crypto', webcrypto)
})

describe('local agent model catalog cache', () => {
  it('loads on demand even before hashing completes, and remembers an empty result', async () => {
    vi.mocked(ipcApi.request).mockResolvedValueOnce({ models: [] })
    const { result } = renderHook(() => useLocalAgentModelCatalog('on-demand', config, false))
    expect(result.current.catalog).toBeUndefined()
    expect(ipcApi.request).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.freshCatalog).toEqual({ models: [] })
    expect(result.current.catalog).toEqual({ models: [] })
  })

  it('shows a persisted list on remount while refreshing and replaces it after success', async () => {
    vi.mocked(ipcApi.request).mockImplementationOnce(async (_route, input) => {
      LocalAgentConfigurationSchema.parse(input)
      return first
    })
    const initial = renderHook(() => useLocalAgentModelCatalog('agent-one', config, true))
    await waitFor(() => expect(initial.result.current.catalog).toEqual(first))
    initial.unmount()
    expect(JSON.stringify(cacheService.getPersist('local_agent.model_catalogs'))).not.toContain('secret-value')

    let resolve!: (value: LocalAgentModelCatalog) => void
    vi.mocked(ipcApi.request).mockImplementationOnce(() => new Promise((done) => (resolve = done)))
    const next = renderHook(() => useLocalAgentModelCatalog('agent-one', config, true))
    await waitFor(() => expect(next.result.current.loading).toBe(true))
    expect(next.result.current.catalog).toEqual(first)
    expect(next.result.current.freshCatalog).toBeUndefined()
    await act(async () => resolve(second))
    expect(next.result.current.catalog).toEqual(second)
    expect(next.result.current.freshCatalog).toEqual(second)
  })

  it('retains the last successful list on failed refresh and propagates manual retry errors', async () => {
    vi.mocked(ipcApi.request).mockResolvedValueOnce(first)
    const initial = renderHook(() => useLocalAgentModelCatalog('agent-one', config, true))
    await waitFor(() => expect(initial.result.current.catalog).toEqual(first))
    initial.unmount()
    vi.mocked(ipcApi.request).mockRejectedValue(new Error('offline'))
    const next = renderHook(() => useLocalAgentModelCatalog('agent-one', config, true))
    await waitFor(() => expect(next.result.current.catalog).toEqual(first))
    await waitFor(() => expect(next.result.current.loading).toBe(false))
    await act(async () => {
      await expect(next.result.current.refresh()).rejects.toThrow('offline')
    })
    expect(next.result.current.catalog).toEqual(first)
    expect(next.result.current.error).toBeUndefined()
    expect(next.result.current.refreshError).toContain('offline')
  })

  it('isolates configuration changes and does not let an old request replace the new catalog', async () => {
    let resolveOld!: (value: LocalAgentModelCatalog) => void
    vi.mocked(ipcApi.request)
      .mockImplementationOnce(() => new Promise((done) => (resolveOld = done)))
      .mockResolvedValueOnce(second)
    const { result, rerender } = renderHook(({ config }) => useLocalAgentModelCatalog('agent-one', config, true), {
      initialProps: { config }
    })
    await waitFor(() => expect(result.current.loading).toBe(true))
    rerender({ config: { ...config, env: { API_KEY: 'another-secret' } } })
    await waitFor(() => expect(result.current.catalog).toEqual(second))
    await act(async () => resolveOld(first))
    expect(result.current.catalog).toEqual(second)
    expect(result.current.freshCatalog).toEqual(second)
    expect(JSON.stringify(cacheService.getPersist('local_agent.model_catalogs'))).not.toContain('another-secret')
  })

  it('does not replace the current connection error with a late failure from old credentials', async () => {
    let rejectOld!: (error: Error) => void
    vi.mocked(ipcApi.request)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject
          })
      )
      .mockRejectedValueOnce(new Error('Authentication required'))
    const { result, rerender } = renderHook(({ config }) => useLocalAgentModelCatalog('one', config, true), {
      initialProps: { config }
    })
    await waitFor(() => expect(result.current.loading).toBe(true))
    rerender({ config: { ...config, env: { API_KEY: 'new' } } })
    await waitFor(() => expect(result.current.error).toContain('Authentication required'))
    expect(result.current.catalog).toBeUndefined()
    expect(result.current.loading).toBe(false)
    await act(async () => rejectOld(new Error('Old connection timed out')))
    expect(result.current.error).toContain('Authentication required')
  })

  it('reuses the catalog across model selections but separates different agents', async () => {
    vi.mocked(ipcApi.request).mockResolvedValueOnce(first)
    const { result, rerender } = renderHook(
      ({ identity, config }) => useLocalAgentModelCatalog(identity, config, true),
      { initialProps: { identity: 'one', config } }
    )
    await waitFor(() => expect(result.current.catalog).toEqual(first))
    rerender({ identity: 'one', config: { ...config, nativeModel: 'first' } })
    expect(result.current.catalog).toEqual(first)
    expect(ipcApi.request).toHaveBeenCalledTimes(1)
    vi.mocked(ipcApi.request).mockResolvedValueOnce({ models: [] })
    rerender({ identity: 'two', config })
    await waitFor(() => expect(result.current.catalog).toEqual({ models: [] }))
  })
})
