import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingInitialSelection } from '../usePaintingInitialSelection'

function makeDraft(providerId: string): PaintingData {
  return { id: `draft-${providerId}`, providerId, mode: 'generate', prompt: '', files: [], params: {} }
}

type Props = Parameters<typeof usePaintingInitialSelection>[0]

describe('usePaintingInitialSelection', () => {
  it('re-seeds the untouched draft on the resolved provider once options resolve (fresh user)', () => {
    const draft = makeDraft('zhipu')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { currentPainting: draft, historyItems: [], initialProviderId: 'zhipu', setCurrentPainting }
    })

    // Provider still matches the draft and there's no history → nothing to do.
    expect(setCurrentPainting).not.toHaveBeenCalled()

    // Options resolve to a different default provider.
    rerender({ currentPainting: draft, historyItems: [], initialProviderId: 'openai', setCurrentPainting })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    const reseeded = setCurrentPainting.mock.calls[0][0]
    expect(reseeded.providerId).toBe('openai')
    expect(reseeded).not.toBe(draft)
  })

  it('adopts the most recent persisted painting when history loads', () => {
    const draft = makeDraft('zhipu')
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { currentPainting: draft, historyItems: [], initialProviderId: 'zhipu', setCurrentPainting }
    })

    rerender({ currentPainting: draft, historyItems: [recent], initialProviderId: 'zhipu', setCurrentPainting })

    expect(setCurrentPainting).toHaveBeenCalledWith(recent)
  })

  it('does nothing once the user has touched the draft (reference changed)', () => {
    const draft = makeDraft('zhipu')
    const touched = { ...draft, prompt: 'edited' }
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { currentPainting: draft, historyItems: [], initialProviderId: 'zhipu', setCurrentPainting }
    })

    // The user edited the draft (new reference) AND history loaded — the guard
    // must still suppress any auto-replacement.
    rerender({ currentPainting: touched, historyItems: [recent], initialProviderId: 'openai', setCurrentPainting })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })
})
