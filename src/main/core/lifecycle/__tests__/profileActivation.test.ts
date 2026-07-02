import { describe, expect, it } from 'vitest'

import {
  type ActivationEffect,
  decideActivate,
  decideDeactivate,
  isProfileActivatable,
  type ProfileBinding
} from '../profileActivation'

const unbound: ProfileBinding = { kind: 'unbound' }
const boundA: ProfileBinding = { kind: 'bound', profileId: 'A' }
const boundB: ProfileBinding = { kind: 'bound', profileId: 'B' }

describe('decideActivate', () => {
  it.each<[ProfileBinding, string, ActivationEffect]>([
    [unbound, 'A', 'acquire'],
    [boundA, 'A', 'none'],
    [boundB, 'A', 'release-then-acquire']
  ])('binding %o activate(%s) → %s', (binding, target, effect) => {
    expect(decideActivate(binding, target)).toBe(effect)
  })
})

describe('decideDeactivate', () => {
  it.each<[ProfileBinding, ActivationEffect]>([
    [unbound, 'none'],
    [boundA, 'release']
  ])('binding %o → %s', (binding, effect) => {
    expect(decideDeactivate(binding)).toBe(effect)
  })
})

describe('isProfileActivatable', () => {
  it('accepts an object with both hooks', () => {
    expect(isProfileActivatable({ onProfileActivate() {}, onProfileDeactivate() {} })).toBe(true)
  })

  it('rejects objects missing a hook, and non-objects', () => {
    expect(isProfileActivatable({ onProfileActivate() {} })).toBe(false)
    expect(isProfileActivatable({ onProfileActivate: 1, onProfileDeactivate() {} })).toBe(false)
    expect(isProfileActivatable(null)).toBe(false)
    expect(isProfileActivatable('x')).toBe(false)
  })
})
