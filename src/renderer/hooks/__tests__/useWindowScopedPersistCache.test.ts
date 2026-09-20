import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { persistTier, memoryTier, setTierValue } = vi.hoisted(() => {
  type Tier = { values: Map<string, unknown>; subscribers: Map<string, Set<() => void>> }
  const persistTier: Tier = { values: new Map(), subscribers: new Map() }
  const memoryTier: Tier = { values: new Map(), subscribers: new Map() }
  const setTierValue = (tier: Tier, key: string, value: unknown) => {
    tier.values.set(key, value)
    tier.subscribers.get(key)?.forEach((callback) => callback())
  }
  return { persistTier, memoryTier, setTierValue }
})

const windowFrameMock = vi.hoisted(() => ({ mode: 'embedded' as 'embedded' | 'window' }))

vi.mock('@renderer/hooks/useWindowFrame', () => ({
  useWindowFrame: () => ({ mode: windowFrameMock.mode })
}))

vi.mock('@renderer/data/hooks/useCache', async () => {
  const { useSyncExternalStore } = await import('react')

  type Tier = { values: Map<string, unknown>; subscribers: Map<string, Set<() => void>> }

  const useTierValue = (tier: Tier, key: string) =>
    useSyncExternalStore(
      (onStoreChange) => {
        if (!tier.subscribers.has(key)) tier.subscribers.set(key, new Set())
        tier.subscribers.get(key)!.add(onStoreChange)
        return () => tier.subscribers.get(key)!.delete(onStoreChange)
      },
      () => tier.values.get(key)
    )

  const setterFor = (tier: Tier, key: string) => (value: unknown) => {
    const next = typeof value === 'function' ? (value as (prev: unknown) => unknown)(tier.values.get(key)) : value
    setTierValue(tier, key, next)
  }

  return {
    usePersistCache: (key: string) => [useTierValue(persistTier, key), setterFor(persistTier, key)],
    useCache: (key: string, initValue?: unknown) => {
      if (!memoryTier.values.has(key) && initValue !== undefined) {
        memoryTier.values.set(key, initValue)
      }
      return [useTierValue(memoryTier, key), setterFor(memoryTier, key)]
    }
  }
})

import { useWindowScopedPersistCache } from '../useWindowScopedPersistCache'

describe('useWindowScopedPersistCache', () => {
  beforeEach(() => {
    persistTier.values.clear()
    persistTier.subscribers.clear()
    memoryTier.values.clear()
    memoryTier.subscribers.clear()
    windowFrameMock.mode = 'embedded'
  })

  it('reads and writes the persisted key in the embedded main window', () => {
    setTierValue(persistTier, 'ui.agent.session.expansion.agent', ['session:agent:a'])

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    expect(result.current[0]).toEqual(['session:agent:a'])

    act(() => result.current[1](['session:agent:b']))

    expect(persistTier.values.get('ui.agent.session.expansion.agent')).toEqual(['session:agent:b'])
  })

  it('seeds the renderer-local key from the persisted value in a detached window', () => {
    windowFrameMock.mode = 'window'
    setTierValue(persistTier, 'ui.agent.session.expansion.agent', ['session:agent:a'])

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    expect(result.current[0]).toEqual(['session:agent:a'])
    expect(memoryTier.values.get('ui.window.agent.session.expansion.agent')).toEqual(['session:agent:a'])
  })

  it('keeps detached writes out of the persisted key', () => {
    windowFrameMock.mode = 'window'

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    act(() => result.current[1](['session:agent:b']))

    expect(memoryTier.values.get('ui.window.agent.session.expansion.agent')).toEqual(['session:agent:b'])
    expect(persistTier.values.has('ui.agent.session.expansion.agent')).toBe(false)
  })

  it('ignores later persisted broadcasts once the detached window has its own value', () => {
    windowFrameMock.mode = 'window'
    setTierValue(persistTier, 'ui.agent.session.expansion.agent', ['session:agent:a'])

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    act(() => result.current[1](['session:agent:b']))

    // Another window writes the persisted key; the detached value must not follow.
    act(() => setTierValue(persistTier, 'ui.agent.session.expansion.agent', ['session:agent:c']))

    expect(result.current[0]).toEqual(['session:agent:b'])
  })
})
