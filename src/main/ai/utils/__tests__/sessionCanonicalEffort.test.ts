import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearSessionCanonicalEffort,
  resolveSessionCanonicalEffort,
  syncSessionCanonicalEffort
} from '../sessionCanonicalEffort'

describe('sessionCanonicalEffort lifecycle', () => {
  beforeEach(() => {
    clearSessionCanonicalEffort('session-a')
    clearSessionCanonicalEffort('session-b')
  })

  it('overwrites the destination when a rebuild resolves a new one', () => {
    syncSessionCanonicalEffort('session-a', 'minimal')
    syncSessionCanonicalEffort('session-a', 'high')
    expect(resolveSessionCanonicalEffort('session-a')).toBe('high')
  })

  it('clears the destination when a rebuild resolves a disabled or default effort', () => {
    syncSessionCanonicalEffort('session-a', 'minimal')
    // Disabled/default effort (or a route that no longer crosses the gateway)
    // resolves no canonical destination: the previous one must not survive
    // into the session's next gateway request.
    syncSessionCanonicalEffort('session-a', undefined)
    expect(resolveSessionCanonicalEffort('session-a')).toBeUndefined()
  })

  it('keeps concurrent sessions isolated: no turn borrows another session destination', () => {
    syncSessionCanonicalEffort('session-a', 'minimal')
    syncSessionCanonicalEffort('session-b', 'low')
    expect(resolveSessionCanonicalEffort('session-a')).toBe('minimal')
    expect(resolveSessionCanonicalEffort('session-b')).toBe('low')
    clearSessionCanonicalEffort('session-a')
    expect(resolveSessionCanonicalEffort('session-a')).toBeUndefined()
    expect(resolveSessionCanonicalEffort('session-b')).toBe('low')
  })

  it('treats clearing an unregistered session as a no-op', () => {
    expect(() => syncSessionCanonicalEffort('session-missing', undefined)).not.toThrow()
    expect(resolveSessionCanonicalEffort('session-missing')).toBeUndefined()
  })
})
