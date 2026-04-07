import miniAppsReducer, { type MiniAppsState, setPinnedMiniApps } from '@renderer/store/miniapps'
import type { MiniAppType } from '@shared/data/types/miniapp'
import { describe, expect, it } from 'vitest'

// Test fixture factory
const createApp = (id: string, name?: string): MiniAppType => ({
  id,
  name: name ?? id,
  url: `https://${id}.example.com`,
  logo: `logo-${id}`
})

describe('miniApps slice — setPinnedMiniApps', () => {
  const buildState = (pinned: MiniAppType[]): MiniAppsState =>
    ({
      enabled: [],
      disabled: [],
      pinned
    }) as MiniAppsState

  it('replaces pinned list with new list', () => {
    const A = createApp('a')
    const B = createApp('b')
    const C = createApp('c')
    const state = buildState([A, B, C])

    const next = miniAppsReducer(state, setPinnedMiniApps([A, C]))

    expect(next.pinned.map((a) => a.id)).toEqual(['a', 'c'])
  })

  it('can set an empty pinned list', () => {
    const A = createApp('a')
    const state = buildState([A])

    const next = miniAppsReducer(state, setPinnedMiniApps([]))

    expect(next.pinned).toEqual([])
  })

  it('strips logo field from pinned apps', () => {
    const app = createApp('a')
    const state = buildState([])

    const next = miniAppsReducer(state, setPinnedMiniApps([app]))

    expect(next.pinned[0].logo).toBeUndefined()
    expect(next.pinned[0].id).toBe('a')
  })
})
