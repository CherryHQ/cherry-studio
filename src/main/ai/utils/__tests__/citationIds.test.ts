import { describe, expect, it } from 'vitest'

import { citeId, newCitePrefix } from '../citationIds'

describe('newCitePrefix', () => {
  it('is always eight hex characters', () => {
    for (let i = 0; i < 50; i++) expect(newCitePrefix()).toMatch(/^[0-9a-f]{8}$/)
  })

  it('does not repeat across the lookup calls one message can hold', () => {
    // A repeat would give two different results the same id, which the renderer
    // resolves to whichever it saw first — dropping the later source silently.
    const prefixes = Array.from({ length: 100 }, newCitePrefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})

describe('citeId', () => {
  it('numbers results from 1, matching what the model is shown', () => {
    expect(citeId('3f2a1b9c', 0)).toBe('3f2a1b9c-1')
    expect(citeId('3f2a1b9c', 4)).toBe('3f2a1b9c-5')
  })
})
