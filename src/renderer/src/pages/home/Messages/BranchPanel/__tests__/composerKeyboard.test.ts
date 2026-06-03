import type { KeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { handleBranchComposerKeyDown } from '../composerKeyboard'

// Minimal synthetic-event factory. `preventDefault` is a spy so we can assert
// the newline is suppressed exactly when (and only when) we submit.
function key(overrides: Partial<KeyboardEvent<HTMLTextAreaElement>> & { isComposing?: boolean }) {
  const { isComposing = false, ...rest } = overrides
  return {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    nativeEvent: { isComposing },
    ...rest
  } as unknown as KeyboardEvent<HTMLTextAreaElement>
}

describe('handleBranchComposerKeyDown (P1-S2c B3 — one shared handler)', () => {
  it('plain Enter (not composing) → submit + preventDefault', () => {
    const submit = vi.fn()
    const ev = key({})
    handleBranchComposerKeyDown(ev, submit)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(ev.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('Shift+Enter → does NOT submit, does NOT preventDefault (newline falls through)', () => {
    const submit = vi.fn()
    const ev = key({ shiftKey: true })
    handleBranchComposerKeyDown(ev, submit)
    expect(submit).not.toHaveBeenCalled()
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('Enter while IME composing → does NOT submit', () => {
    const submit = vi.fn()
    const ev = key({ isComposing: true })
    handleBranchComposerKeyDown(ev, submit)
    expect(submit).not.toHaveBeenCalled()
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('Ctrl+Enter / Meta+Enter → do NOT submit (Enter-only override)', () => {
    const submit = vi.fn()
    handleBranchComposerKeyDown(key({ ctrlKey: true }), submit)
    handleBranchComposerKeyDown(key({ metaKey: true }), submit)
    expect(submit).not.toHaveBeenCalled()
  })

  it('non-Enter keys are ignored', () => {
    const submit = vi.fn()
    handleBranchComposerKeyDown(key({ key: 'a' }), submit)
    expect(submit).not.toHaveBeenCalled()
  })
})
