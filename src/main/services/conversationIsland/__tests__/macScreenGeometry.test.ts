import type { Display } from 'electron'
import { describe, expect, it } from 'vitest'

import { parseMacScreenGeometry, resolveConversationIslandBounds } from '../macScreenGeometry'

const display = {
  id: 42,
  bounds: { x: 1000, y: 24, width: 1120, height: 720 }
} as Display

const validGeometry = {
  screenNumber: 42,
  frame: { x: 100, y: 0, width: 1120, height: 720 },
  safeAreaInsets: { top: 32, left: 0, bottom: 0, right: 0 },
  auxiliaryTopLeftArea: { x: 100, y: 688, width: 500, height: 32 },
  auxiliaryTopRightArea: { x: 720, y: 688, width: 500, height: 32 }
}

describe('macScreenGeometry', () => {
  it('maps AppKit-relative notch geometry onto the Electron display bounds', () => {
    const geometries = parseMacScreenGeometry(JSON.stringify([validGeometry]))

    expect(resolveConversationIslandBounds(display, geometries, 320)).toEqual({
      bounds: { x: 1400, y: 24, width: 320, height: 38 },
      presentation: 'notch',
      notchWidth: 120
    })
  })

  it.each(['not json', '{}', JSON.stringify([{ ...validGeometry, screenNumber: 1.5 }])])(
    'rejects malformed probe output: %s',
    (raw) => {
      expect(parseMacScreenGeometry(raw)).toEqual(new Map())
    }
  )

  it('falls back when the probe has no row for the Electron display', () => {
    const geometries = parseMacScreenGeometry(JSON.stringify([{ ...validGeometry, screenNumber: 7 }]))

    expect(resolveConversationIslandBounds(display, geometries, 320)).toEqual({
      bounds: { x: 1400, y: 32, width: 320, height: 38 },
      presentation: 'capsule'
    })
  })

  it('falls back when the auxiliary areas describe an implausibly wide notch', () => {
    const geometries = parseMacScreenGeometry(
      JSON.stringify([
        {
          ...validGeometry,
          auxiliaryTopLeftArea: { x: 100, y: 688, width: 300, height: 32 },
          auxiliaryTopRightArea: { x: 820, y: 688, width: 400, height: 32 }
        }
      ])
    )

    expect(resolveConversationIslandBounds(display, geometries, 320).presentation).toBe('capsule')
  })

  it('drops invalid rows while preserving valid display geometry', () => {
    const geometries = parseMacScreenGeometry(
      JSON.stringify([
        { ...validGeometry, screenNumber: 'invalid' },
        validGeometry,
        { ...validGeometry, screenNumber: 9, frame: { x: 0, y: 0, width: -1, height: 10 } }
      ])
    )

    expect([...geometries.keys()]).toEqual([42])
  })
})
