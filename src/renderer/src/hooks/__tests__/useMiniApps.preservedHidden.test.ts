import { configureStore } from '@reduxjs/toolkit'
import miniAppsReducer, { setPinnedMinApps } from '@renderer/store/miniapps'
import type { MiniAppRegion } from '@shared/data/types/miniapp'
import type { MiniAppType } from '@shared/data/types/miniapp'
import { describe, expect, it } from 'vitest'

// This test uses the legacy MiniAppType (Redux model) so it cannot use the
// shared createMiniApp fixture (which targets the v2 MiniApp interface).
// The legacy factory is intentionally kept minimal since this file tests
// the old Redux slice which is scheduled for removal in v2.

const createApp = (id: string, overrides?: Partial<MiniAppType>): MiniAppType => ({
  id,
  name: id,
  url: `https://${id}.example.com`,
  logo: `logo-${id}`,
  ...overrides
})

const createGlobalApp = (id: string): MiniAppType => createApp(id, { supportedRegions: ['Global'] as MiniAppRegion[] })

const createCnOnlyApp = (id: string): MiniAppType => createApp(id, { supportedRegions: ['CN'] as MiniAppRegion[] })

describe('setPinnedMinApps — no preservedHidden re-append', () => {
  it('should remove CN-only pinned app without re-append', () => {
    const globalApp = createGlobalApp('openai')
    const cnOnlyApp = createCnOnlyApp('yi')
    const store = configureStore({
      reducer: { miniApps: miniAppsReducer }
    })

    store.dispatch(setPinnedMinApps([globalApp, cnOnlyApp]))
    store.dispatch(setPinnedMinApps([globalApp]))

    const state = store.getState().miniApps
    expect(state.pinned.map((a) => a.id)).toEqual(['openai'])
  })

  it('should allow setting an empty pinned list', () => {
    const globalApp = createGlobalApp('openai')
    const cnOnlyApp = createCnOnlyApp('yi')
    const store = configureStore({
      reducer: { miniApps: miniAppsReducer }
    })

    store.dispatch(setPinnedMinApps([globalApp, cnOnlyApp]))
    store.dispatch(setPinnedMinApps([]))

    const state = store.getState().miniApps
    expect(state.pinned).toEqual([])
  })

  it('should strip logo field from pinned apps', () => {
    const app = createApp('a', { logo: 'logo-a' })
    const store = configureStore({
      reducer: { miniApps: miniAppsReducer }
    })

    store.dispatch(setPinnedMinApps([app]))

    const state = store.getState().miniApps
    expect(state.pinned[0].logo).toBeUndefined()
    expect(state.pinned[0].id).toBe('a')
  })
})
