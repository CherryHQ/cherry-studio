// @vitest-environment jsdom

import { cacheService } from '@data/CacheService'
import { DefaultUseCache } from '@shared/data/cache/cacheSchemas'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppUpdateState } from '../useAppUpdateState'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

function createDefaultUpdateState(): CacheAppUpdateState {
  return { ...DefaultUseCache['app.dist.update_state'] }
}

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

    cacheService.set('app.dist.update_state', createDefaultUpdateState())
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
      cacheService.set('app.dist.update_state', {
        ...createDefaultUpdateState(),
        checking: true
      })

      updateFromInitialRender({ downloading: true })
    })

    expect(cacheService.get('app.dist.update_state')).toMatchObject({
      checking: true,
      downloading: true
    })
  })
})
