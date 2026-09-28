import { describe, expect, it } from 'vitest'

import { applyContextExclusions } from '../contextExclusion'

const m = (id: string) => ({ id, role: 'user' })

describe('applyContextExclusions', () => {
  it('returns the input untouched when nothing is excluded', () => {
    const messages = [m('m1'), m('m2')]
    expect(applyContextExclusions(messages, new Set())).toBe(messages)
  })

  it('drops only the excluded ids, wherever they sit', () => {
    const messages = [m('m1'), m('m2'), m('m3'), m('m4')]
    expect(applyContextExclusions(messages, new Set(['m2', 'm4'])).map((r) => r.id)).toEqual(['m1', 'm3'])
  })

  it('ignores excluded ids that are not on this path', () => {
    const messages = [m('m1'), m('m2')]
    expect(applyContextExclusions(messages, new Set(['not-here']))).toEqual(messages)
  })

  it('can drop every message', () => {
    const messages = [m('m1'), m('m2')]
    expect(applyContextExclusions(messages, new Set(['m1', 'm2']))).toEqual([])
  })
})
