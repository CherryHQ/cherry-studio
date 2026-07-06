/**
 * Contract regression tests for the multi-select design invariants.
 *
 * These two transitions were explicitly called out in PR #14490 as the
 * contracts most likely to silently break under future refactors, so they
 * are pinned here at the pure-function level — no component plumbing or
 * mocks required.
 */

import type { UniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { computeCollapsedSelection, computeToggledSelection } from '../selection'

const ID_A = 'openai::gpt-4' as UniqueModelId
const ID_B = 'anthropic::claude-3' as UniqueModelId
const ID_C = 'google::gemini-1.5' as UniqueModelId

describe('computeCollapsedSelection — multiSelectMode ON→OFF invariant', () => {
  it('collapses to the first resolved id when it differs from the raw snapshot', () => {
    const resolved: UniqueModelId[] = [ID_A, ID_B]
    const raw: UniqueModelId[] = [ID_A, ID_B, ID_C]

    expect(computeCollapsedSelection(resolved, raw)).toEqual([ID_A])
  })

  it('returns null (no emit) when the collapsed value already equals raw', () => {
    // Already a single id and identical — emitting would be a useless write
    // that churns consumers and could reset focus / scroll state.
    const single: UniqueModelId[] = [ID_A]

    expect(computeCollapsedSelection(single, single)).toBeNull()
  })

  it('returns empty array when resolved is empty and raw has entries (callers must emit to truncate)', () => {
    // A business value with only ids belonging to currently-disabled providers
    // leaves `resolved` empty; the UI should reflect that by collapsing to [].
    const raw: UniqueModelId[] = [ID_A, ID_B]

    expect(computeCollapsedSelection([], raw)).toEqual([])
  })

  it('is a pure snapshot — does not mutate inputs', () => {
    const resolved: UniqueModelId[] = [ID_A, ID_B]
    const raw: UniqueModelId[] = [ID_B, ID_C]
    const resolvedSnapshot = [...resolved]
    const rawSnapshot = [...raw]

    computeCollapsedSelection(resolved, raw)

    expect(resolved).toEqual(resolvedSnapshot)
    expect(raw).toEqual(rawSnapshot)
  })
})

describe('computeToggledSelection — toggle-on-raw invariant', () => {
  it('preserves ids belonging to a currently-disabled provider when removing a visible id', () => {
    // ID_C would normally be filtered out of `resolvedSelectedModelIds`
    // (its provider is temporarily disabled). Toggling on `raw` keeps it.
    const raw: UniqueModelId[] = [ID_A, ID_C]

    expect(computeToggledSelection(raw, ID_A)).toEqual([ID_C])
  })

  it('appends a new id to the raw base when it is not already present', () => {
    const raw: UniqueModelId[] = [ID_A, ID_C]

    expect(computeToggledSelection(raw, ID_B)).toEqual([ID_A, ID_C, ID_B])
  })

  it('removes the target id and preserves relative order of the rest', () => {
    const raw: UniqueModelId[] = [ID_A, ID_B, ID_C]

    expect(computeToggledSelection(raw, ID_B)).toEqual([ID_A, ID_C])
  })

  it('handles toggle-from-empty by appending the id', () => {
    expect(computeToggledSelection([], ID_A)).toEqual([ID_A])
  })

  it('is a pure snapshot — does not mutate the raw base', () => {
    const raw: UniqueModelId[] = [ID_A, ID_B]
    const rawSnapshot = [...raw]

    computeToggledSelection(raw, ID_A)

    expect(raw).toEqual(rawSnapshot)
  })
})
