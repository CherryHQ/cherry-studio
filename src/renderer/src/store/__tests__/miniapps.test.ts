import miniAppsReducer, { type MinAppsState, type MiniAppType, setPinnedMinApps } from '@renderer/store/miniapps'
import { describe, expect, it } from 'vitest'

// Test fixture factory
const createApp = (id: string, name?: string): MiniAppType => ({
  id,
  name: name ?? id,
  url: `https://${id}.example.com`,
  logo: `logo-${id}`
})

describe('miniApps slice — setPinnedMinApps', () => {
  const buildState = (pinned: MiniAppType[]): MinAppsState =>
    ({
      enabled: [],
      disabled: [],
      pinned
    }) as MinAppsState

  it('replaces pinned list with new list', () => {
    const A = createApp('a')
    const B = createApp('b')
    const C = createApp('c')
    const state = buildState([A, B, C])

    const next = miniAppsReducer(state, setPinnedMinApps([A, C]))

    expect(next.pinned.map((a) => a.id)).toEqual(['a', 'c'])
  })

  it('can set an empty pinned list', () => {
    const A = createApp('a')
    const state = buildState([A])

    const next = miniAppsReducer(state, setPinnedMinApps([]))

    expect(next.pinned).toEqual([])
  })

  it('strips logo field from pinned apps', () => {
    const app = createApp('a')
    const state = buildState([])

    const next = miniAppsReducer(state, setPinnedMinApps([app]))

    expect(next.pinned[0].logo).toBeUndefined()
    expect(next.pinned[0].id).toBe('a')
  })
})
