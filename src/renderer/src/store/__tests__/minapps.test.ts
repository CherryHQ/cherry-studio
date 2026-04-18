import minAppsReducer, { type MinAppsState, moveMinApp, setPinnedMinApps } from '@renderer/store/minapps'
import type { MinAppType } from '@renderer/types'
import { describe, expect, it } from 'vitest'

// Test fixture factory
const createApp = (id: string, name?: string): MinAppType => ({
  id,
  name: name ?? id,
  url: `https://${id}.example.com`,
  logo: `logo-${id}`
})

const buildState = (overrides: Partial<MinAppsState> = {}): MinAppsState =>
  ({
    enabled: [],
    disabled: [],
    pinned: [],
    iconOnly: false,
    categoryColumns: 1,
    ...overrides
  }) as MinAppsState

describe('minApps slice — setPinnedMinApps', () => {
  it('replaces pinned list with new list', () => {
    const A = createApp('a')
    const B = createApp('b')
    const C = createApp('c')
    const state = buildState({ pinned: [A, B, C] })

    const next = minAppsReducer(state, setPinnedMinApps([A, C]))

    expect(next.pinned.map((a) => a.id)).toEqual(['a', 'c'])
  })

  it('can set an empty pinned list', () => {
    const A = createApp('a')
    const state = buildState({ pinned: [A] })

    const next = minAppsReducer(state, setPinnedMinApps([]))

    expect(next.pinned).toEqual([])
  })

  it('strips logo field from pinned apps', () => {
    const app = createApp('a')
    const state = buildState()

    const next = minAppsReducer(state, setPinnedMinApps([app]))

    expect(next.pinned[0].logo).toBeUndefined()
    expect(next.pinned[0].id).toBe('a')
  })
})

describe('minApps slice — moveMinApp', () => {
  it('moves an app from enabled to pinned', () => {
    const A = createApp('a')
    const state = buildState({ enabled: [A], pinned: [] })

    const next = minAppsReducer(state, moveMinApp({ appId: 'a', from: 'enabled', to: 'pinned' }))

    expect(next.enabled).toHaveLength(0)
    expect(next.pinned.map((a) => a.id)).toEqual(['a'])
  })

  it('moves an app from pinned to disabled', () => {
    const A = createApp('a')
    const state = buildState({ pinned: [A], disabled: [] })

    const next = minAppsReducer(state, moveMinApp({ appId: 'a', from: 'pinned', to: 'disabled' }))

    expect(next.pinned).toHaveLength(0)
    expect(next.disabled.map((a) => a.id)).toEqual(['a'])
  })

  it('moves an app from disabled to enabled', () => {
    const A = createApp('a')
    const state = buildState({ disabled: [A], enabled: [] })

    const next = minAppsReducer(state, moveMinApp({ appId: 'a', from: 'disabled', to: 'enabled' }))

    expect(next.disabled).toHaveLength(0)
    expect(next.enabled.map((a) => a.id)).toEqual(['a'])
  })

  it('does nothing when from === to', () => {
    const A = createApp('a')
    const state = buildState({ enabled: [A] })

    const next = minAppsReducer(state, moveMinApp({ appId: 'a', from: 'enabled', to: 'enabled' }))

    expect(next.enabled.map((a) => a.id)).toEqual(['a'])
  })

  it('does nothing when app not found in source', () => {
    const state = buildState({ enabled: [], pinned: [] })

    const next = minAppsReducer(state, moveMinApp({ appId: 'nonexistent', from: 'enabled', to: 'pinned' }))

    expect(next.enabled).toHaveLength(0)
    expect(next.pinned).toHaveLength(0)
  })

  it('strips logo field when moving', () => {
    const A = createApp('a')
    const state = buildState({ enabled: [A] })

    const next = minAppsReducer(state, moveMinApp({ appId: 'a', from: 'enabled', to: 'pinned' }))

    expect(next.pinned[0].logo).toBeUndefined()
  })
})
