import { afterEach, describe, expect, it, vi } from 'vitest'

import { citeId, newCitePrefix } from '../citationIds'

afterEach(() => vi.restoreAllMocks())

describe('newCitePrefix', () => {
  it('is always three base36 characters', () => {
    for (let i = 0; i < 50; i++) expect(newCitePrefix()).toMatch(/^[a-z0-9]{3}$/)
  })

  it('pads a random draw whose base36 form is too short', () => {
    // Math.random() === 0 renders as "0", leaving nothing after slice(2, 5).
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(newCitePrefix()).toBe('000')
  })
})

describe('citeId', () => {
  it('numbers results from 1, matching what the model is shown', () => {
    expect(citeId('k3f', 0)).toBe('k3f-1')
    expect(citeId('k3f', 4)).toBe('k3f-5')
  })
})
