import { describe, expect, it } from 'vitest'

import { shouldStartApiServerOnLaunch } from '../autoStart'

describe('shouldStartApiServerOnLaunch', () => {
  it('returns true when enabled', () => {
    expect(shouldStartApiServerOnLaunch(true, false, 0)).toBe(true)
  })

  it('returns false when disabled and autoStart is false', () => {
    expect(shouldStartApiServerOnLaunch(false, false, 999)).toBe(false)
  })

  it('returns false when disabled and there are no agents', () => {
    expect(shouldStartApiServerOnLaunch(false, true, 0)).toBe(false)
  })

  it('returns true when disabled, autoStart is true, and agents exist', () => {
    expect(shouldStartApiServerOnLaunch(false, true, 1)).toBe(true)
  })
})
