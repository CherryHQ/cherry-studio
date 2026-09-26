import { describe, expect, it } from 'vitest'

import type { UniqueModelId } from '@shared/data/types/model'

import {
  computeCollapsedSelection,
  computeToggledSelection,
  countStaleSelectedModelIds,
  hasStaleSelectedModelIds,
  resolveSelectedModelIds
} from '../selection'

const ID_A = 'openai::gpt-4' as UniqueModelId
const ID_B = 'anthropic::claude-3' as UniqueModelId
const ID_C = 'google::gemini-1.5' as UniqueModelId
const ID_STALE = 'openai::deleted' as UniqueModelId

describe('resolveSelectedModelIds', () => {
  it('deduplicates ids and drops entries missing from the selectable catalog', () => {
    const selectableIds = new Set([ID_A, ID_B])
    expect(resolveSelectedModelIds([ID_A, ID_A, ID_B, ID_STALE], selectableIds)).toEqual([ID_A, ID_B])
  })
})

describe('stale selected model ids', () => {
  it('counts unique raw ids that no longer resolve', () => {
    expect(countStaleSelectedModelIds([ID_STALE, ID_A, ID_STALE], [ID_A])).toBe(1)
  })

  it('detects when raw and resolved selections diverge', () => {
    expect(hasStaleSelectedModelIds([ID_STALE], [])).toBe(true)
    expect(hasStaleSelectedModelIds([ID_A], [ID_A])).toBe(false)
  })
})

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
