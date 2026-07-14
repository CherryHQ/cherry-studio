import { afterEach, describe, expect, it } from 'vitest'

import {
  abortPaintingGeneration,
  clearPaintingAbortController,
  getPaintingAbortController,
  registerPaintingAbortController
} from '../paintingAbortControllerStore'

// The store is module-level singleton state; clear the ids each test touches so
// cases don't leak controllers into one another.
afterEach(() => {
  clearPaintingAbortController('p1')
  clearPaintingAbortController('p2')
})

describe('paintingAbortControllerStore', () => {
  it('registers and retrieves a controller by painting id', () => {
    const controller = new AbortController()
    registerPaintingAbortController('p1', controller)
    expect(getPaintingAbortController('p1')).toBe(controller)
    expect(getPaintingAbortController('p2')).toBeNull()
  })

  it('aborts the previous controller when a new one is registered for the same id', () => {
    const first = new AbortController()
    const second = new AbortController()
    registerPaintingAbortController('p1', first)
    registerPaintingAbortController('p1', second)

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(getPaintingAbortController('p1')).toBe(second)
  })

  it('clears only when the supplied controller is still the registered one (identity guard)', () => {
    const current = new AbortController()
    const stale = new AbortController()
    registerPaintingAbortController('p1', current)

    // A stale controller (already replaced) must not evict the live one.
    clearPaintingAbortController('p1', stale)
    expect(getPaintingAbortController('p1')).toBe(current)

    // The live controller clears itself.
    clearPaintingAbortController('p1', current)
    expect(getPaintingAbortController('p1')).toBeNull()
  })

  it('clears unconditionally when no controller is supplied', () => {
    registerPaintingAbortController('p1', new AbortController())
    clearPaintingAbortController('p1')
    expect(getPaintingAbortController('p1')).toBeNull()
  })

  it('aborts the registered controller for a painting id', () => {
    const controller = new AbortController()
    registerPaintingAbortController('p1', controller)
    abortPaintingGeneration('p1')
    expect(controller.signal.aborted).toBe(true)
  })

  it('is a no-op to abort an id with no registered controller', () => {
    expect(() => abortPaintingGeneration('missing')).not.toThrow()
  })
})
