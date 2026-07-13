import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type ComposerDraft, createDraft } from '../../model/composerDraft'
import { usePaintingInitialSelection } from '../usePaintingInitialSelection'

const makeDraft = (providerId: string): ComposerDraft => createDraft(providerId)

type Props = Parameters<typeof usePaintingInitialSelection>[0]

describe('usePaintingInitialSelection', () => {
  it('re-seeds the untouched draft on the resolved provider once options resolve (fresh user)', () => {
    const draft = makeDraft('zhipu')
    const setDraft = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { draft, initialProviderId: 'zhipu', setDraft }
    })

    // Provider still matches the draft → nothing to do.
    expect(setDraft).not.toHaveBeenCalled()

    // Options resolve to a different default provider.
    rerender({ draft, initialProviderId: 'openai', setDraft })

    expect(setDraft).toHaveBeenCalledTimes(1)
    const reseeded = setDraft.mock.calls[0][0] as ComposerDraft
    expect(reseeded.providerId).toBe('openai')
    expect(reseeded).not.toBe(draft)
  })

  it('never auto-adopts a persisted painting — the composer stays an independent draft', () => {
    const draft = makeDraft('zhipu')
    const setDraft = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { draft, initialProviderId: 'zhipu', setDraft }
    })

    // Provider unchanged, even as history loads elsewhere → never touches the draft.
    rerender({ draft, initialProviderId: 'zhipu', setDraft })

    expect(setDraft).not.toHaveBeenCalled()
  })

  it('does nothing once the user has touched the draft (reference changed)', () => {
    const draft = makeDraft('zhipu')
    const touched = { ...draft, prompt: 'edited' }
    const setDraft = vi.fn()
    const { rerender } = renderHook<void, Props>((props) => usePaintingInitialSelection(props), {
      initialProps: { draft, initialProviderId: 'zhipu', setDraft }
    })

    // The user edited the draft (new reference) — the guard suppresses re-seed.
    rerender({ draft: touched, initialProviderId: 'openai', setDraft })

    expect(setDraft).not.toHaveBeenCalled()
  })
})
