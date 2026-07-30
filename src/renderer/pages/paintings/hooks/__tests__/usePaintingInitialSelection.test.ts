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
    const { rerender, result } = renderHook<boolean, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: {
        currentPainting: draft,
        historyItems: [],
        historyIsLoading: false,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    // Provider still matches the draft and there's no history → nothing to do.
    expect(setCurrentPainting).not.toHaveBeenCalled()
    expect(result.current).toBe(true)

    // Options resolve to a different default provider.
    rerender({
      currentPainting: draft,
      historyItems: [],
      historyIsLoading: false,
      initialProviderId: 'openai',
      setCurrentPainting
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    const reseeded = setCurrentPainting.mock.calls[0][0]
    expect(reseeded.providerId).toBe('openai')
    expect(reseeded).not.toBe(draft)
  })

  it('adopts the most recent persisted painting when history loads', () => {
    const draft = makeDraft('zhipu')
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender, result } = renderHook<boolean, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: {
        currentPainting: draft,
        historyItems: [],
        historyIsLoading: true,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    expect(result.current).toBe(false)

    rerender({
      currentPainting: draft,
      historyItems: [recent],
      historyIsLoading: false,
      initialProviderId: 'zhipu',
      setCurrentPainting
    })

    expect(setCurrentPainting).toHaveBeenCalledWith(recent)
    expect(result.current).toBe(true)
  })

  it('waits for initial history before adopting instead of re-seeding the draft early', () => {
    const draft = makeDraft('zhipu')
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender, result } = renderHook<boolean, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: {
        currentPainting: draft,
        historyItems: [],
        historyIsLoading: true,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    rerender({
      currentPainting: draft,
      historyItems: [],
      historyIsLoading: true,
      initialProviderId: 'openai',
      setCurrentPainting
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
    expect(result.current).toBe(false)

    rerender({
      currentPainting: draft,
      historyItems: [recent],
      historyIsLoading: false,
      initialProviderId: 'openai',
      setCurrentPainting
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    expect(setCurrentPainting).toHaveBeenCalledWith(recent)
    expect(result.current).toBe(true)
  })

  it('does not replace an edited unsaved draft when history loads', () => {
    const draft = makeDraft('zhipu')
    const editedDraft = { ...draft, prompt: 'edited prompt' }
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender, result } = renderHook<boolean, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: {
        currentPainting: draft,
        historyItems: [],
        historyIsLoading: true,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    rerender({
      currentPainting: editedDraft,
      historyItems: [recent],
      historyIsLoading: false,
      initialProviderId: 'zhipu',
      setCurrentPainting
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
    expect(result.current).toBe(true)
  })

  it('does not replace a user-created blank draft when history loads', () => {
    const initialDraft = makeDraft('zhipu')
    const userCreatedDraft = { ...makeDraft('zhipu'), id: 'user-created-draft' }
    const recent = makeDraft('aihubmix')
    const setCurrentPainting = vi.fn()
    const { rerender, result } = renderHook<boolean, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: {
        currentPainting: initialDraft,
        historyItems: [],
        historyIsLoading: true,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    rerender({
      currentPainting: userCreatedDraft,
      historyItems: [recent],
      historyIsLoading: false,
      initialProviderId: 'zhipu',
      setCurrentPainting
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
    expect(result.current).toBe(true)
  })

  it('keeps an explicit new blank draft ready after history bootstrap', () => {
    const draft = makeDraft('zhipu')
    const recent = makeDraft('aihubmix')
    const newDraft = makeDraft('openai')
    const setCurrentPainting = vi.fn()
    const { rerender, result } = renderHook<boolean, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: {
        currentPainting: draft,
        historyItems: [],
        historyIsLoading: true,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    rerender({
      currentPainting: draft,
      historyItems: [recent],
      historyIsLoading: false,
      initialProviderId: 'zhipu',
      setCurrentPainting
    })
    rerender({
      currentPainting: newDraft,
      historyItems: [recent],
      historyIsLoading: false,
      initialProviderId: 'openai',
      setCurrentPainting
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })
})
