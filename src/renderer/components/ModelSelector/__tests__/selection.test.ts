import type { UniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { computeCollapsedSelection, computeToggledSelection } from '../selection'

const ID_A = 'openai::gpt-4' as UniqueModelId
const ID_B = 'anthropic::claude-3' as UniqueModelId
const ID_C = 'google::gemini-1.5' as UniqueModelId

describe('computeCollapsedSelection', () => {
  it.each([
    {
      name: 'keeps the first resolved id',
      resolved: [ID_A, ID_B],
      raw: [ID_A, ID_B, ID_C],
      expected: [ID_A]
    },
    {
      name: 'clears a raw selection with no selectable ids',
      resolved: [],
      raw: [ID_A, ID_B],
      expected: []
    }
  ])('$name', ({ resolved, raw, expected }) => {
    expect(computeCollapsedSelection(resolved, raw)).toEqual(expected)
  })

  it('does not emit when the raw value is already collapsed', () => {
    expect(computeCollapsedSelection([ID_A], [ID_A])).toBeNull()
  })
})

describe('computeToggledSelection', () => {
  it('preserves hidden raw ids while removing the target', () => {
    expect(computeToggledSelection([ID_A, ID_C], ID_A)).toEqual([ID_C])
  })

  it('appends a missing id to the raw selection', () => {
    expect(computeToggledSelection([ID_A, ID_C], ID_B)).toEqual([ID_A, ID_C, ID_B])
  })
})
