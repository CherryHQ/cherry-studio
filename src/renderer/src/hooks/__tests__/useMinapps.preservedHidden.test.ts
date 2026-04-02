import { configureStore } from '@reduxjs/toolkit'
import minAppsReducer, { setPinnedMinApps } from '@renderer/store/minapps'
import type { MinAppRegion, MinAppType } from '@renderer/types'
import { describe, expect, it } from 'vitest'

// Test fixture factory
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
  // Core fix: setPinnedMinApps replaces the list directly,
  // so removing a CN-only app from the pinned list stays removed.
  it('should remove CN-only pinned app without re-append', () => {
    const globalApp = createGlobalApp('openai')
    const cnOnlyApp = createCnOnlyApp('yi')
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    // Pre-populate with both apps pinned
    store.dispatch(setPinnedMinApps([globalApp, cnOnlyApp]))

    // Simulate user removing the CN-only app (filter it out and set directly)
    store.dispatch(setPinnedMinApps([globalApp]))

    // Assert: CN-only app is gone, NOT re-appended
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

  // Regression: setPinnedMinApps strips logo field
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
