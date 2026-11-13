// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { DefaultSharedCache, DefaultUseCache } from '@shared/data/cache/cacheSchemas'

import { useAppUpdateState } from '../useAppUpdateState'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

describe('useAppUpdateState', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ipcApi: { request: vi.fn(async () => undefined), on: vi.fn(() => () => {}) },
        cache: {
          broadcastSync: vi.fn(),
          onSync: vi.fn(),
          getAllShared: vi.fn(async () => ({}))
        }
      }
    })

    cacheService.set('app.dist.update_state', { ...DefaultUseCache['app.dist.update_state'] })
    cacheService.setShared('app.dist.update_status', { ...DefaultSharedCache['app.dist.update_status'] })
  })

  it('merges patches against the latest cache value', () => {
    const { result } = renderHook(() => useAppUpdateState())
    const updateFromInitialRender = result.current.updateAppUpdateState

    act(() => {
      cacheService.setShared('app.dist.update_status', {
        ...DefaultSharedCache['app.dist.update_status'],
        checking: true
      })

      updateFromInitialRender({ downloading: true })
    })

    expect(cacheService.getShared('app.dist.update_status')).toMatchObject({
      checking: true,
      downloading: true
    })
  })

  it('reads shared updater facts while retaining this window intent', () => {
    cacheService.set('app.dist.update_state', { manualCheck: false, ignore: true })
    const { result } = renderHook(() => useAppUpdateState())
    act(() =>
      cacheService.setShared('app.dist.update_status', {
        ...DefaultSharedCache['app.dist.update_status'],
        available: true,
        downloading: true,
        downloadProgress: 65
      })
    )
    expect(result.current.appUpdateState).toMatchObject({
      available: true,
      downloadProgress: 65,
      manualCheck: false,
      ignore: true
    })
  })

  it('clears shared failure feedback when a new check starts', () => {
    cacheService.setShared('app.dist.update_status', {
      ...DefaultSharedCache['app.dist.update_status'],
      lastErrorKey: 'settings.about.updateError'
    })
    const { result } = renderHook(() => useAppUpdateState())
    act(() => result.current.updateAppUpdateState({ checking: true }))
    expect(result.current.appUpdateState.lastErrorKey).toBeNull()
  })

  it('shares update progress without sharing the window request to show an install dialog', () => {
    const { result } = renderHook(() => useAppUpdateState())
    act(() => result.current.updateAppUpdateState({ downloading: true, downloadProgress: 42, manualCheck: true }))
    expect(window.api.cache.broadcastSync).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'app.dist.update_status',
        value: expect.objectContaining({ downloading: true, downloadProgress: 42 })
      })
    )
    const broadcasts = vi.mocked(window.api.cache.broadcastSync).mock.calls
    expect(
      broadcasts.every(([message]) => !('manualCheck' in (message.value ?? {})) && !('ignore' in (message.value ?? {})))
    ).toBe(true)
    expect(result.current.appUpdateState.manualCheck).toBe(true)
  })

  it.each(['checking', 'downloading'] as const)(
    'does not start a check while the latest status is %s',
    async (busy) => {
      const { result } = renderHook(() => useAppUpdateState())
      const check = result.current.checkForUpdate
      act(() =>
        cacheService.setShared('app.dist.update_status', {
          ...DefaultSharedCache['app.dist.update_status'],
          [busy]: true
        })
      )
      await act(check)
      expect(window.api.ipcApi.request).not.toHaveBeenCalled()
      expect(result.current.appUpdateState.manualCheck).toBe(false)
      expect(result.current.appUpdateState[busy]).toBe(true)
    }
  )

  it('opens the downloaded update without starting another check', async () => {
    const showUpdateDialog = vi.fn(async () => undefined)
    const info = { version: '2.2.0', files: [], path: '', sha512: '', releaseDate: '2026-10-19' }
    cacheService.setShared('app.dist.update_status', {
      ...DefaultSharedCache['app.dist.update_status'],
      downloaded: true,
      info
    })
    const { result } = renderHook(() => useAppUpdateState(showUpdateDialog))
    await act(() => result.current.checkForUpdate())
    expect(showUpdateDialog).toHaveBeenCalledWith(info)
    expect(window.api.ipcApi.request).not.toHaveBeenCalled()
    expect(result.current.appUpdateState.manualCheck).toBe(false)
  })

  it('releases a failed check for retry and ignores another entry while a check is pending', async () => {
    const request = vi.spyOn(ipcApi, 'request').mockRejectedValueOnce(new Error('Disconnected'))
    const { result } = renderHook(() => useAppUpdateState())
    await act(() => result.current.checkForUpdate())
    expect(result.current.appUpdateState).toMatchObject({ checking: false, manualCheck: false })
    expect(toast.error).toHaveBeenCalled()
    const pending = Promise.withResolvers<void>()
    request.mockImplementationOnce(() => pending.promise)
    let checking: Promise<void>
    act(() => {
      checking = result.current.checkForUpdate()
    })
    expect(result.current.appUpdateState).toMatchObject({ checking: true, manualCheck: true })
    await act(() => result.current.checkForUpdate())
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith('app.updater.check_for_update')
    await act(async () => {
      pending.resolve()
      await checking
    })
    expect(result.current.appUpdateState).toMatchObject({ checking: false, manualCheck: true })
    request.mockRestore()
  })
})
