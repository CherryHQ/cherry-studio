import { configureStore } from '@reduxjs/toolkit'
import minAppsReducer, { setPinnedMinApps } from '@renderer/store/minapps'
import type { MinAppRegion } from '@shared/data/types/miniapp'
import type { MinAppType } from '@shared/data/types/miniapp'
import { describe, expect, it } from 'vitest'

// This test uses the legacy MinAppType (Redux model) so it cannot use the
// shared createMiniApp fixture (which targets the v2 MiniApp interface).
// The legacy factory is intentionally kept minimal since this file tests
// the old Redux slice which is scheduled for removal in v2.

const createApp = (id: string, overrides?: Partial<MinAppType>): MinAppType => ({
  id,
  name: id,
  url: `https://${id}.example.com`,
  logo: `logo-${id}`,
  ...overrides
})

const createGlobalApp = (id: string): MinAppType => createApp(id, { supportedRegions: ['Global'] as MinAppRegion[] })

const createCnOnlyApp = (id: string): MinAppType => createApp(id, { supportedRegions: ['CN'] as MinAppRegion[] })

describe('setPinnedMinApps — no preservedHidden re-append', () => {
  it('should remove CN-only pinned app without re-append', () => {
    const globalApp = createGlobalApp('openai')
    const cnOnlyApp = createCnOnlyApp('yi')
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    store.dispatch(setPinnedMinApps([globalApp, cnOnlyApp]))
    store.dispatch(setPinnedMinApps([globalApp]))

    const state = store.getState().minApps
    expect(state.pinned.map((a) => a.id)).toEqual(['openai'])
  })

  it('should allow setting an empty pinned list', () => {
    const globalApp = createGlobalApp('openai')
    const cnOnlyApp = createCnOnlyApp('yi')
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    store.dispatch(setPinnedMinApps([globalApp, cnOnlyApp]))
    store.dispatch(setPinnedMinApps([]))

    const state = store.getState().minApps
    expect(state.pinned).toEqual([])
  })

  it('should strip logo field from pinned apps', () => {
    const app = createApp('a', { logo: 'logo-a' })
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    store.dispatch(setPinnedMinApps([app]))

    const state = store.getState().minApps
    expect(state.pinned[0].logo).toBeUndefined()
    expect(state.pinned[0].id).toBe('a')
  })
})
