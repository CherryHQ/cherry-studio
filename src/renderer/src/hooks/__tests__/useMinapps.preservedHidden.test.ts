import { configureStore } from '@reduxjs/toolkit'
import minAppsReducer, {
  type MinAppsState,
  removePinnedMinapp,
  setPinnedMinApps} from '@renderer/store/minapps'
import type { MinAppRegion } from '@renderer/types'
import type { MinAppType } from '@renderer/types'
import { describe, expect, it } from 'vitest'

// Test fixture factory
const createApp = (id: string, overrides?: Partial<MinAppType>): MinAppType => ({
  id,
  name: id,
  url: `https://${id}.example.com`,
  logo: `logo-${id}`,
  ...overrides
})

const createGlobalApp = (id: string): MinAppType =>
  createApp(id, { supportedRegions: ['Global'] as MinAppRegion[] })

const createCnOnlyApp = (id: string): MinAppType =>
  createApp(id, { supportedRegions: ['CN'] as MinAppRegion[] })

describe('useMinapps hook — preservedHidden integration', () => {
  // Test that removePinnedMinapp bypasses preservedHidden
  it('should remove CN-only pinned app without re-append', () => {
    const globalApp = createGlobalApp('openai')
    const cnOnlyApp = createCnOnlyApp('yi')
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    // Pre-populate with both apps pinned
    store.dispatch(setPinnedMinApps([globalApp, cnOnlyApp]))

    // Remove the CN-only app
    store.dispatch(removePinnedMinapp('yi'))

    // Assert: CN-only app is gone, NOT re-appended
    const state = store.getState().minApps as MinAppsState
    expect(state.pinned.map((a) => a.id)).toEqual(['openai'])
  })

  // Test that setPinnedMinApps (direct set) bypasses preservedHidden
  it('should set pinned list directly without re-append', () => {
    const globalApp = createGlobalApp('openai')
    const cnOnlyApp = createCnOnlyApp('yi')
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    // Pre-populate
    store.dispatch(setPinnedMinApps([globalApp, cnOnlyApp]))

    // Direct set to only global app
    store.dispatch(setPinnedMinApps([globalApp]))

    // Assert: only global app remains
    const state = store.getState().minApps as MinAppsState
    expect(state.pinned.map((a) => a.id)).toEqual(['openai'])
  })

  // Test that removePinnedMinapp with non-existent ID leaves list unchanged
  it('should not alter pinned list when removing non-existent app', () => {
    const globalApp = createGlobalApp('openai')
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    store.dispatch(setPinnedMinApps([globalApp]))

    store.dispatch(removePinnedMinapp('nonexistent'))

    const state = store.getState().minApps as MinAppsState
    expect(state.pinned.map((a) => a.id)).toEqual(['openai'])
  })

  // Test that setPinnedMinApps strips logo field (regression)
  it('should strip logo field from pinned apps', () => {
    const app = createApp('a', { logo: 'logo-a' })
    const store = configureStore({
      reducer: { minApps: minAppsReducer }
    })

    store.dispatch(setPinnedMinApps([app]))

    const state = store.getState().minApps as MinAppsState
    expect(state.pinned[0].logo).toBeUndefined()
    expect(state.pinned[0].id).toBe('a')
  })
})
