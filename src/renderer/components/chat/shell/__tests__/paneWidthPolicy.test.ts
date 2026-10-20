import { describe, expect, it } from 'vitest'

import {
  buildDockedPaneWidthExpression,
  evaluateAutoCollapse,
  getPaneSpaceCap,
  predictCenterWidth,
  resolveDockedPaneWidth
} from '../paneWidthPolicy'

const STORED_DEFAULT = 460

describe('resolveDockedPaneWidth', () => {
  it('keeps the stored width while the center retains its comfort width', () => {
    expect(resolveDockedPaneWidth(STORED_DEFAULT + 360, STORED_DEFAULT)).toBe(STORED_DEFAULT)
    expect(resolveDockedPaneWidth(1200, STORED_DEFAULT)).toBe(STORED_DEFAULT)
  })

  it('yields the pane first: stored → 255 while the center keeps 360', () => {
    expect(resolveDockedPaneWidth(STORED_DEFAULT + 359, STORED_DEFAULT)).toBe(STORED_DEFAULT - 1)
    expect(resolveDockedPaneWidth(700, STORED_DEFAULT)).toBe(340)
    expect(resolveDockedPaneWidth(615, STORED_DEFAULT)).toBe(255)
  })

  it('yields the center next: 360 → 200 with the pane pinned at 255', () => {
    expect(resolveDockedPaneWidth(614, STORED_DEFAULT)).toBe(255)
    expect(resolveDockedPaneWidth(455, STORED_DEFAULT)).toBe(255)
    expect(614 - resolveDockedPaneWidth(614, STORED_DEFAULT)).toBe(359)
    expect(455 - resolveDockedPaneWidth(455, STORED_DEFAULT)).toBe(200)
  })

  it('shrinks both proportionally below 455 and never reaches zero', () => {
    expect(resolveDockedPaneWidth(400, STORED_DEFAULT)).toBeCloseTo((400 * 255) / 455, 5)
    expect(resolveDockedPaneWidth(100, STORED_DEFAULT)).toBeGreaterThan(0)
    expect(resolveDockedPaneWidth(0, STORED_DEFAULT)).toBe(0)
  })

  it('is continuous at every segment boundary', () => {
    for (const boundary of [455, 615, STORED_DEFAULT + 360]) {
      const below = resolveDockedPaneWidth(boundary - 0.001, STORED_DEFAULT)
      const above = resolveDockedPaneWidth(boundary + 0.001, STORED_DEFAULT)
      expect(Math.abs(above - below)).toBeLessThan(0.01)
    }
  })

  it('matches current behaviour point-for-point at and above 615', () => {
    for (const available of [615, 700, 819, 820, 1000]) {
      const legacy = Math.min(STORED_DEFAULT, Math.max(0, available - 360))
      expect(resolveDockedPaneWidth(available, STORED_DEFAULT)).toBe(legacy)
    }
  })
})

describe('buildDockedPaneWidthExpression', () => {
  it('mirrors the JS formula as a single CSS expression', () => {
    expect(buildDockedPaneWidthExpression(460)).toBe(
      'max(min(460px, calc(100% - 360px)), min(255px, calc(100% * 255 / 455)))'
    )
  })

  it('accepts non-numeric css lengths', () => {
    expect(buildDockedPaneWidthExpression('var(--assistants-width)')).toContain('min(var(--assistants-width),')
  })
})

describe('predictCenterWidth', () => {
  it('predicts the list-expanded center independent of the current list state', () => {
    // A1: shell 641, list 275, panel open at stored 460 → available 366, pane ≈205.
    const predicted = predictCenterWidth({ shellWidth: 641, listWidth: 275, paneOpen: true, paneWidth: 460 })
    expect(predicted).toBeCloseTo(366 - (366 * 255) / 455, 5)
    expect(predicted).toBeLessThan(360)
  })

  it('drops the pane term when the panel is closed', () => {
    expect(predictCenterWidth({ shellWidth: 641, listWidth: 275, paneOpen: false, paneWidth: 460 })).toBe(366)
  })
})

describe('evaluateAutoCollapse', () => {
  it('collapses below the comfort threshold', () => {
    expect(evaluateAutoCollapse(359.9, false)).toBe(true)
  })

  it('holds the current state inside the hysteresis dead zone', () => {
    expect(evaluateAutoCollapse(361, true)).toBe(true)
    expect(evaluateAutoCollapse(361, false)).toBe(false)
  })

  it('restores at or above the hysteresis line', () => {
    expect(evaluateAutoCollapse(364, true)).toBe(false)
  })
})

describe('space cap and handle usability', () => {
  it('caps resize commits at the space the pane can currently show', () => {
    expect(getPaneSpaceCap(700)).toBe(340)
    expect(getPaneSpaceCap(500)).toBe(255)
  })
})
