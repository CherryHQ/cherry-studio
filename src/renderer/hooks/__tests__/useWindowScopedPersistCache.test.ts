import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

import { installCacheApiMock } from '../../data/hooks/__tests__/testUtils'

const windowFrameMock = vi.hoisted(() => ({ mode: 'embedded' as 'embedded' | 'window' }))

vi.mock('@renderer/hooks/useWindowFrame', () => ({
  useWindowFrame: () => ({ mode: windowFrameMock.mode })
}))

// Run against the real cache tiers (renderer.setup.ts mocks both globally): a bespoke useCache
// double skipped seeding a null initValue, so the window key stayed absent and a later persisted
// broadcast re-seeded it — a leak the production seeding effect does not have, because it seeds
// null too and the present key blocks every re-seed.
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

import { useWindowScopedPersistCache } from '../useWindowScopedPersistCache'

describe('useWindowScopedPersistCache', () => {
  beforeEach(() => {
    installCacheApiMock()
    cacheService.setPersist('ui.agent.session.expansion.agent', null)
    cacheService.delete('ui.window.agent.session.expansion.agent')
    windowFrameMock.mode = 'embedded'
  })

  it('reads and writes the persisted key in the embedded main window', () => {
    cacheService.setPersist('ui.agent.session.expansion.agent', ['session:agent:a'])

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    expect(result.current[0]).toEqual(['session:agent:a'])

    act(() => result.current[1](['session:agent:b']))

    expect(cacheService.getPersist('ui.agent.session.expansion.agent')).toEqual(['session:agent:b'])
  })

  it('seeds the renderer-local key from the persisted value in a detached window', () => {
    windowFrameMock.mode = 'window'
    cacheService.setPersist('ui.agent.session.expansion.agent', ['session:agent:a'])

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    expect(result.current[0]).toEqual(['session:agent:a'])
    expect(cacheService.get('ui.window.agent.session.expansion.agent')).toEqual(['session:agent:a'])
  })

  it('keeps detached writes out of the persisted key', () => {
    windowFrameMock.mode = 'window'

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    act(() => result.current[1](['session:agent:b']))

    expect(cacheService.get('ui.window.agent.session.expansion.agent')).toEqual(['session:agent:b'])
    expect(cacheService.getPersist('ui.agent.session.expansion.agent')).toBeNull()
  })

  it('ignores later persisted broadcasts once the detached window has its own value', () => {
    windowFrameMock.mode = 'window'
    cacheService.setPersist('ui.agent.session.expansion.agent', ['session:agent:a'])

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    act(() => result.current[1](['session:agent:b']))

    // Another window writes the persisted key; the detached value must not follow.
    act(() => cacheService.setPersist('ui.agent.session.expansion.agent', ['session:agent:c']))

    expect(result.current[0]).toEqual(['session:agent:b'])
  })

  it('keeps a seeded null detached value when another window broadcasts a persisted update', () => {
    windowFrameMock.mode = 'window'

    const { result } = renderHook(() =>
      useWindowScopedPersistCache('ui.agent.session.expansion.agent', 'ui.window.agent.session.expansion.agent')
    )

    // The persist side holds the schema default null: the seeding effect writes that null into
    // the window tier, so the present key keeps a later broadcast from re-seeding the value.
    expect(result.current[0]).toBeNull()

    act(() => cacheService.setPersist('ui.agent.session.expansion.agent', ['session:agent:x']))

    expect(result.current[0]).toBeNull()
  })

  it('seeds a key bound later in a detached window from that key, not from the first one', () => {
    windowFrameMock.mode = 'window'
    cacheService.setPersist('ui.chat.artifact_pane.width', 280)
    cacheService.setPersist('ui.chat.profile_pane.width', 400)
    cacheService.delete('ui.window.chat.artifact_pane.width')
    cacheService.delete('ui.window.chat.profile_pane.width')

    type Key = 'ui.chat.artifact_pane.width' | 'ui.chat.profile_pane.width'
    const windowKey = {
      'ui.chat.artifact_pane.width': 'ui.window.chat.artifact_pane.width',
      'ui.chat.profile_pane.width': 'ui.window.chat.profile_pane.width'
    } as const
    const { result, rerender } = renderHook(
      ({ cacheKey }: { cacheKey: Key }) => useWindowScopedPersistCache(cacheKey, windowKey[cacheKey]),
      { initialProps: { cacheKey: 'ui.chat.artifact_pane.width' as Key } }
    )
    expect(result.current[0]).toBe(280)

    rerender({ cacheKey: 'ui.chat.profile_pane.width' })

    expect(result.current[0]).toBe(400)
  })
})
