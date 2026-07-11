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

  it('adopts history after the untouched draft was re-seeded for the resolved provider', () => {
    const draft = makeDraft('zhipu')
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { currentPainting: draft, historyItems: [], initialProviderId: 'zhipu', setCurrentPainting }
    })

    rerender({ currentPainting: draft, historyItems: [], initialProviderId: 'openai', setCurrentPainting })

    const reseeded = setCurrentPainting.mock.calls[0][0] as PaintingData

    rerender({ currentPainting: reseeded, historyItems: [recent], initialProviderId: 'openai', setCurrentPainting })

    expect(setCurrentPainting).toHaveBeenNthCalledWith(2, recent)
  })

  it('does not replace an edited unsaved draft when history loads', () => {
    const draft = makeDraft('zhipu')
    const editedDraft = { ...draft, prompt: 'edited prompt' }
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { currentPainting: draft, historyItems: [], initialProviderId: 'zhipu', setCurrentPainting }
    })

    rerender({ currentPainting: editedDraft, historyItems: [recent], initialProviderId: 'zhipu', setCurrentPainting })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })

  it('does not re-adopt history after the first bootstrap completes', () => {
    const draft = makeDraft('zhipu')
    const recent = makeDraft('aihubmix')
    const newDraft = makeDraft('openai')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { currentPainting: draft, historyItems: [], initialProviderId: 'zhipu', setCurrentPainting }
    })

    rerender({ currentPainting: draft, historyItems: [recent], initialProviderId: 'zhipu', setCurrentPainting })
    rerender({ currentPainting: newDraft, historyItems: [recent], initialProviderId: 'openai', setCurrentPainting })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
  })
})
