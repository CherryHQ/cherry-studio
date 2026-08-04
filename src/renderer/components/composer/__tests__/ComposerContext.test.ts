import { describe, expect, it } from 'vitest'

import { type ComposerOverride, selectActiveComposerOverride } from '../ComposerContext'

function makeOverride(id: string, priority?: number): ComposerOverride {
  return {
    id,
    priority,
    render: () => id
  }
}

describe('selectActiveComposerOverride', () => {
  it('returns the highest priority override', () => {
    expect(selectActiveComposerOverride([makeOverride('default'), makeOverride('ask-user-question', 100)])?.id).toBe(
      'ask-user-question'
    )
  })

  it('keeps declaration order when priorities match', () => {
    expect(selectActiveComposerOverride([makeOverride('first', 10), makeOverride('second', 10)])?.id).toBe('first')
  })

  it('returns null without overrides', () => {
    expect(selectActiveComposerOverride([])).toBeNull()
    expect(selectActiveComposerOverride(null)).toBeNull()
  })
})
