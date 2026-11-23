import { describe, expect, it } from 'vitest'

import { splitCompressionWindow } from '../compressionWindow'

const path = [
  { id: 'u0', role: 'user' },
  { id: 'a0', role: 'assistant' },
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'a1-continuation', role: 'assistant' },
  { id: 'u2', role: 'user' },
  { id: 'a2', role: 'assistant' },
  { id: 'u3', role: 'user' }
]

describe('splitCompressionWindow', () => {
  it('counts whole rounds, keeping every assistant continuation with its user', () => {
    const plan = splitCompressionWindow(path, 2, 3)!
    expect(plan.middle.map((row) => row.id)).toEqual(['u1', 'a1', 'a1-continuation'])
    expect(plan.recent.map((row) => row.id)).toEqual(['u2', 'a2', 'u3'])
    expect(plan.window.map((row) => row.id)).not.toContain('u0')
  })

  it('keeps short histories without inventing a compressed zone or mutating the input', () => {
    const original = path.map((row) => ({ ...row }))
    expect(splitCompressionWindow(path, 10, 20)).toEqual({ window: path, recent: path, middle: [] })
    expect(path).toEqual(original)
    expect(splitCompressionWindow([], 1, 2)).toEqual({ window: [], middle: [], recent: [] })
  })

  it.each([
    [null, 5],
    [undefined, 5],
    [0, 5],
    [2, null],
    [2, undefined],
    [2, 2],
    [3, 2],
    [2, 2.5],
    [Number.NaN, 5],
    [2, Number.POSITIVE_INFINITY],
    [1.5, 5]
  ])('disables invalid bounds A=%s B=%s', (recent, total) => {
    expect(splitCompressionWindow(path, recent, total)).toBeNull()
  })
})
