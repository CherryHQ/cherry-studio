import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createPathOverlapCheck } from '../pathIdentity'

describe(`path identity (${process.platform})`, () => {
  it.each([true, false])('respects case sensitivity %s for missing names', (caseSensitive) => {
    const parent = process.cwd()
    const target = path.join(parent, 'cherry-future-session')
    const overlaps = createPathOverlapCheck([target], new Map([[parent, { caseSensitive, unicodeSensitive: true }]]))
    expect(overlaps(path.join(parent, 'CHERRY-FUTURE-SESSION', 'project'))).toBe(!caseSensitive)
    expect(overlaps(path.join(target, 'project'))).toBe(true)
    expect(overlaps(parent)).toBe(true)
    expect(overlaps(`${target}-other`)).toBe(false)
  })

  it.each([true, false])('respects Unicode sensitivity %s for missing names', (unicodeSensitive) => {
    const parent = process.cwd()
    const target = path.join(parent, 'cherry-future-caf\u00e9')
    const overlaps = createPathOverlapCheck([target], new Map([[parent, { caseSensitive: true, unicodeSensitive }]]))
    expect(overlaps(path.join(parent, 'cherry-future-cafe\u0301', 'project'))).toBe(!unicodeSensitive)
  })
})
