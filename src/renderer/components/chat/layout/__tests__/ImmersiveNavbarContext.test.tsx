import { describe, expect, it } from 'vitest'

import { resolveImmersiveNavbar } from '../ImmersiveNavbarContext'

describe('resolveImmersiveNavbar', () => {
  it('floats and reserves the embedded navbar height when narrow and the center is wide enough', () => {
    expect(resolveImmersiveNavbar({ narrow: true, centerWidth: 1200, isWindow: false })).toEqual({
      floating: true,
      insetHeight: 44
    })
  })

  it('floats and reserves the window title-bar height in window mode', () => {
    expect(resolveImmersiveNavbar({ narrow: true, centerWidth: 1200, isWindow: true })).toEqual({
      floating: true,
      insetHeight: 37.5
    })
  })

  it('does not float when the column is not narrow, however wide the center is', () => {
    expect(resolveImmersiveNavbar({ narrow: false, centerWidth: 2000, isWindow: false })).toEqual({
      floating: false,
      insetHeight: 0
    })
  })

  it('gates floating on the embedded threshold (column 848 + reserve 116)', () => {
    expect(resolveImmersiveNavbar({ narrow: true, centerWidth: 963, isWindow: false }).floating).toBe(false)
    expect(resolveImmersiveNavbar({ narrow: true, centerWidth: 964, isWindow: false }).floating).toBe(true)
  })

  it('requires more width in window mode (column 848 + reserve 208) for the wider chrome', () => {
    expect(resolveImmersiveNavbar({ narrow: true, centerWidth: 1055, isWindow: true }).floating).toBe(false)
    expect(resolveImmersiveNavbar({ narrow: true, centerWidth: 1056, isWindow: true }).floating).toBe(true)
  })
})
