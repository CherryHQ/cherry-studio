import type { Display } from 'electron'
import { describe, expect, it } from 'vitest'

import {
  parseMacScreenGeometry,
  resolveConversationIslandBounds,
  resolveConversationIslandSize
} from '../macScreenGeometry'

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

    expect(resolveConversationIslandBounds(display, geometries, { width: 320, height: 38 })).toEqual({
      bounds: { x: 1400, y: 24, width: 320, height: 38 },
      presentation: 'notch',
      notchWidth: 120
    })
  })

  it('uses the expanded notch size when placing multiple activities', () => {
    const geometries = parseMacScreenGeometry(JSON.stringify([validGeometry]))
    const size = resolveConversationIslandSize('notch', 8)

    expect(resolveConversationIslandBounds(display, geometries, size)).toEqual({
      bounds: { x: 1350, y: 24, width: 420, height: 258 },
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

    expect(resolveConversationIslandBounds(display, geometries, { width: 320, height: 38 })).toEqual({
      bounds: { x: 1400, y: 32, width: 320, height: 38 },
      presentation: 'capsule'
    })
  })

  it('uses the expanded capsule size when notch geometry is unavailable', () => {
    const size = resolveConversationIslandSize('capsule', 8)

    expect(resolveConversationIslandBounds(display, new Map(), size)).toEqual({
      bounds: { x: 1350, y: 32, width: 420, height: 236 },
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

    expect(resolveConversationIslandBounds(display, geometries, { width: 320, height: 38 }).presentation).toBe(
      'capsule'
    )
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

  it.each([
    ['capsule', 1, { width: 420, height: 60 }],
    ['capsule', 2, { width: 420, height: 104 }],
    ['capsule', 5, { width: 420, height: 236 }],
    ['capsule', 8, { width: 420, height: 236 }],
    ['notch', 1, { width: 420, height: 82 }],
    ['notch', 2, { width: 420, height: 126 }],
    ['notch', 5, { width: 420, height: 258 }],
    ['notch', 8, { width: 420, height: 258 }]
  ] as const)('resolves %s size for %i activities', (presentation, activityCount, expected) => {
    expect(resolveConversationIslandSize(presentation, activityCount)).toEqual(expected)
  })
})
