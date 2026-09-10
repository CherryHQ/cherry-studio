import { cacheService } from '@data/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())

const { useMiniAppAttention, useMiniAppAttentionFor } = await import('../useMiniAppAttention')

const lit = (appId: string) => ({
  appId,
  updateVersion: '1.1.0',
  pendingPermissions: [],
  updating: null
})

beforeEach(() => cacheService.deleteShared('mini_app.attention'))

it('reads the main-owned attention snapshot available before mount', () => {
  cacheService.setShared('mini_app.attention', [lit('com.example.game')])

  const { result } = renderHook(() => useMiniAppAttention())

  expect(result.current).toEqual([lit('com.example.game')])
})

it('reacts when main replaces the shared attention snapshot', () => {
  cacheService.setShared('mini_app.attention', [lit('com.example.a')])
  const { result } = renderHook(() => useMiniAppAttention())

  act(() => cacheService.setShared('mini_app.attention', [lit('com.example.b')]))
  expect(result.current).toEqual([lit('com.example.b')])
})

it('selects one app without creating another synchronization owner', () => {
  cacheService.setShared('mini_app.attention', [lit('com.example.a')])

  const { result } = renderHook(() => useMiniAppAttentionFor('com.example.a'))

  expect(result.current).toEqual(lit('com.example.a'))
})
