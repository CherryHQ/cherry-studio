import { describe, expect, it } from 'vitest'

import minAppsReducer, {
  removePinnedMinapp,
  setPinnedMinApps,
  type MinAppsState
} from '@renderer/store/minapps'

import type { MinAppType } from '@renderer/types'

// Test fixture factory
const createApp = (id: string, name?: string): MinAppType => ({
  id,
  name: name ?? id,
  url: `https://${id}.example.com`,
  logo: `logo-${id}`
})

describe('minApps slice — removePinnedMinapp', () => {
  const buildState = (pinned: MinAppType[]): MinAppsState =>
    ({
      enabled: [],
      disabled: [],
      pinned
    }) as MinAppsState

  it('removes target app from pinned list', () => {
    // Arrange
    const A = createApp('a')
    const B = createApp('b')
    const C = createApp('c')
    const state = buildState([A, B, C])

    // Act
    const next = minAppsReducer(state, removePinnedMinapp('b'))

    // Assert
    expect(next.pinned.map((a) => a.id)).toEqual(['a', 'c'])
  })

  it('removes CN-only app without re-append (preservedHidden bypass)', () => {
    // This is the core fix for issue #13875.
    // removePinnedMinapp dispatches directly — no preservedHidden logic.
    // Arrange
    const globalApp = createApp('openai')
    const cnOnlyApp = createApp('yi')
    const state = buildState([globalApp, cnOnlyApp])

    // Act — remove the CN-only app
    const next = minAppsReducer(state, removePinnedMinapp('yi'))

    // Assert — yi is gone, NOT re-appended by region-preserve logic
    expect(next.pinned.map((a) => a.id)).toEqual(['openai'])
  })

  it('has no effect when removing non-existent app ID', () => {
    // Arrange
    const A = createApp('a')
    const B = createApp('b')
    const state = buildState([A, B])

    // Act
    const next = minAppsReducer(state, removePinnedMinapp('nonexistent'))

    // Assert — pinned list unchanged
    expect(next.pinned.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('setPinnedMinApps strips logo field (existing behavior preserved)', () => {
    // Arrange
    const app = createApp('a')
    const state = buildState([])

    // Act
    const next = minAppsReducer(state, setPinnedMinApps([app]))

    // Assert — logo is stripped by the reducer
    expect(next.pinned[0].logo).toBeUndefined()
    expect(next.pinned[0].id).toBe('a')
  })
})
