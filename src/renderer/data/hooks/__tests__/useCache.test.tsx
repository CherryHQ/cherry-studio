import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const broadcastSync = vi.fn()
const getAllShared = vi.fn(async () => ({}))
const onSync = vi.fn()

beforeEach(() => {
  vi.resetModules()
  broadcastSync.mockClear()
  getAllShared.mockClear()
  onSync.mockClear()
  localStorage.clear()

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync,
        getAllShared,
        onSync
      }
    }
  })
})

async function loadRealCacheModules() {
  vi.doUnmock('@data/CacheService')
  vi.doUnmock('@data/hooks/useCache')
  const hooks = await import('../useCache')
  const { cacheService } = await import('@data/CacheService')
  return { ...hooks, cacheService }
}

describe('useCache functional setters', () => {
  it('resolves useCache updater against the latest memory cache value', async () => {
    const { cacheService, useCache } = await loadRealCacheModules()
    try {
      cacheService.set('mini_app.show', false)
      const { result, unmount } = renderHook(() => useCache('mini_app.show'))
      const setShow = result.current[1]

      act(() => {
        cacheService.set('mini_app.show', true)
        setShow((wasShowing) => !wasShowing)
      })

      expect(cacheService.get('mini_app.show')).toBe(false)
      unmount()
    } finally {
      cacheService.cleanup()
    }
  })

  it('resolves useSharedCache updater against the latest shared cache value', async () => {
    const { cacheService, useSharedCache } = await loadRealCacheModules()
    try {
      cacheService.setShared('feature.api_gateway.running', false)
      const { result, unmount } = renderHook(() => useSharedCache('feature.api_gateway.running'))
      const setRunning = result.current[1]

      act(() => {
        cacheService.setShared('feature.api_gateway.running', true)
        setRunning((isRunning) => !isRunning)
      })

      expect(cacheService.getShared('feature.api_gateway.running')).toBe(false)
      unmount()
    } finally {
      cacheService.cleanup()
    }
  })

  it('resolves usePersistCache updater against the latest persisted cache value', async () => {
    const { cacheService, usePersistCache } = await loadRealCacheModules()
    try {
      cacheService.setPersist('ui.sidebar.width', 10)
      const { result, unmount } = renderHook(() => usePersistCache('ui.sidebar.width'))
      const setWidth = result.current[1]

      act(() => {
        cacheService.setPersist('ui.sidebar.width', 20)
        setWidth((width) => width + 1)
      })

      expect(cacheService.getPersist('ui.sidebar.width')).toBe(21)
      unmount()
    } finally {
      cacheService.cleanup()
    }
  })
})
