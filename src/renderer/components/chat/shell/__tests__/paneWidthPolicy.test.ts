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

  it('shrinks both proportionally below 455 and never reaches zero', () => {
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
})

describe('buildDockedPaneWidthExpression', () => {
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
  it('holds the current state inside the hysteresis dead zone', () => {
    expect(evaluateAutoCollapse(361, true)).toBe(true)
    expect(evaluateAutoCollapse(361, false)).toBe(false)
  })
})

describe('space cap and handle usability', () => {
  it('caps resize commits at the space the pane can currently show', () => {
    expect(getPaneSpaceCap(700)).toBe(340)
    expect(getPaneSpaceCap(500)).toBe(255)
  })
})
