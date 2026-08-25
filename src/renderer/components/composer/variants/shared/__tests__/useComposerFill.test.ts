import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useComposerFill } from '../useComposerFill'

describe('useComposerFill', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderFill(topicId: string, draftText: string) {
    const apply = vi.fn()
    const focus = vi.fn()
    const actionsRef = {
      current: {
        focus,
        getDraft: () => ({ text: draftText })
      }
    }

    renderHook(() => useComposerFill(actionsRef, topicId, apply))
    return { apply, focus }
  }

  it('fills and focuses the matching empty composer without sending', async () => {
    const { apply, focus } = renderFill('topic-1', '')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'other-topic', text: 'Ignore me' })
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
    })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('Use this prompt')
    expect(focus).toHaveBeenCalledWith('end')
  })

  it('does not replace a non-empty draft', async () => {
    const { apply, focus } = renderFill('topic-1', 'already typed')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
    })

    expect(apply).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })
})
