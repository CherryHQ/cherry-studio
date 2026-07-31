import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingInitialDraft } from '../usePaintingInitialDraft'

function makeDraft(providerId: string): PaintingData {
  return { id: `draft-${providerId}`, providerId, mode: 'generate', prompt: '', files: [], params: {} }
}

type Props = Parameters<typeof usePaintingInitialDraft>[0]

describe('usePaintingInitialDraft', () => {
  it('re-seeds the untouched draft on the resolved provider once options resolve (fresh user)', () => {
    const draft = makeDraft('zhipu')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialDraft(props), {
      initialProps: {
        currentPainting: draft,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    // Provider still matches the draft → nothing to do.
    expect(setCurrentPainting).not.toHaveBeenCalled()

    // Options resolve to a different default provider.
    rerender({
      currentPainting: draft,
      initialProviderId: 'openai',
      setCurrentPainting
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    const reseeded = setCurrentPainting.mock.calls[0][0]
    expect(reseeded.providerId).toBe('openai')
    expect(reseeded).not.toBe(draft)
  })

  it('re-seeds immediately when the resolved provider differs on mount', () => {
    const draft = makeDraft('zhipu')
    const setCurrentPainting = vi.fn()
    renderHook<void, Props>((props) => usePaintingInitialDraft(props), {
      initialProps: {
        currentPainting: draft,
        initialProviderId: 'openai',
        setCurrentPainting
      }
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    expect(setCurrentPainting.mock.calls[0][0].providerId).toBe('openai')
    expect(setCurrentPainting.mock.calls[0][0]).not.toBe(draft)
  })

  it('does not replace an edited unsaved draft when the provider resolves', () => {
    const draft = makeDraft('zhipu')
    const editedDraft = { ...draft, prompt: 'edited prompt' }
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialDraft(props), {
      initialProps: {
        currentPainting: draft,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    rerender({
      currentPainting: editedDraft,
      initialProviderId: 'openai',
      setCurrentPainting
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })

  it('does not replace a user-created blank draft when the provider resolves', () => {
    const initialDraft = makeDraft('zhipu')
    const userCreatedDraft = { ...makeDraft('zhipu'), id: 'user-created-draft' }
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialDraft(props), {
      initialProps: {
        currentPainting: initialDraft,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    rerender({
      currentPainting: userCreatedDraft,
      initialProviderId: 'openai',
      setCurrentPainting
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })

  it('does not re-seed an explicit new blank draft', () => {
    const draft = makeDraft('zhipu')
    const newDraft = makeDraft('openai')
    const setCurrentPainting = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialDraft(props), {
      initialProps: {
        currentPainting: draft,
        initialProviderId: 'zhipu',
        setCurrentPainting
      }
    })

    rerender({
      currentPainting: newDraft,
      initialProviderId: 'gemini',
      setCurrentPainting
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })
})
