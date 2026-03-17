import { describe, expect, it } from 'vitest'

import { isNavbarTabVisible } from '../navigationVisibility'

describe('isNavbarTabVisible', () => {
  it('keeps the home tab visible when assistants are enabled', () => {
    expect(isNavbarTabVisible('home', ['assistants', 'agents'])).toBe(true)
  })

  it('hides the agents tab when agents is removed from visible sidebar icons', () => {
    expect(isNavbarTabVisible('agents', ['assistants', 'store'])).toBe(false)
  })

  it('does not hide tabs that are not controlled by sidebar icon settings', () => {
    expect(isNavbarTabVisible('settings', ['assistants'])).toBe(true)
    expect(isNavbarTabVisible('apps:custom-minapp', ['assistants'])).toBe(true)
  })
})
