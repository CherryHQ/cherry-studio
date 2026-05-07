import { describe, expect, it } from 'vitest'

import { findNextPromptVariableRange } from '../promptVariableNavigation'

describe('findNextPromptVariableRange', () => {
  it('finds the first prompt variable after the cursor', () => {
    const text = 'Plan a route from ${from} to ${to}'

    expect(findNextPromptVariableRange(text, 0, 0)).toEqual({ start: 18, end: 25 })
  })

  it('continues after the current selection before wrapping', () => {
    const text = 'Plan a route from ${from} to ${to}'

    expect(findNextPromptVariableRange(text, 18, '${from}'.length)).toEqual({ start: 29, end: 34 })
  })

  it('wraps to the first prompt variable when none remain after the cursor', () => {
    const text = 'Plan a route from ${from} to ${to}'

    expect(findNextPromptVariableRange(text, text.length, 0)).toEqual({ start: 18, end: 25 })
  })

  it('returns null when no prompt variables exist', () => {
    expect(findNextPromptVariableRange('Plain prompt text', 0, 0)).toBeNull()
  })
})
