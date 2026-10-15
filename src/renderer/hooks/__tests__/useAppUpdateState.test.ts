// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { DefaultSharedCache, DefaultUseCache } from '@shared/data/cache/cacheSchemas'

import { useAppUpdateState } from '../useAppUpdateState'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

describe('useAppUpdateState', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
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

  it('keeps updateAppUpdateState stable across rerenders', () => {
    const { result, rerender } = renderHook(() => useAppUpdateState())
    const firstUpdate = result.current.updateAppUpdateState

    rerender()

    expect(result.current.updateAppUpdateState).toBe(firstUpdate)
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
})
