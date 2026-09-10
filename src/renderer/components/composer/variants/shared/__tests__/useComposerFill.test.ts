import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../../tokens'
import { useComposerFill } from '../useComposerFill'

describe('useComposerFill', () => {
  let nextFrameId = 0
  let pendingFrames = new Map<number, FrameRequestCallback>()

  beforeEach(() => {
    nextFrameId = 0
    pendingFrames = new Map()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++nextFrameId
      pendingFrames.set(id, cb)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingFrames.delete(id)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function flushAnimationFrames() {
    const frames = [...pendingFrames.entries()]
    pendingFrames.clear()
    for (const [, callback] of frames) {
      callback(0)
    }
  }

  function renderFill(
    topicId: string,
    draft: { text: string; tokens?: ComposerSerializedToken[] } | string,
    getFillDraft?: () => { text: string; tokens?: ComposerSerializedToken[] }
  ) {
    const apply = vi.fn()
    const focus = vi.fn()
    const serialized =
      typeof draft === 'string' ? { text: draft, tokens: [] } : { text: draft.text, tokens: draft.tokens ?? [] }
    const actionsRef = {
      current: {
        focus,
        getDraft: () => serialized
      }
    }

    const hook = renderHook(() => useComposerFill(actionsRef, topicId, apply, getFillDraft))
    return { apply, focus, actionsRef, unmount: hook.unmount, rerender: hook.rerender }
  }

  it('fills and focuses the matching empty composer without sending', async () => {
    const { apply, focus } = renderFill('topic-1', '')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'other-topic', text: 'Ignore me' })
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
      flushAnimationFrames()
    })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('Use this prompt')
    expect(focus).toHaveBeenCalledWith('end')
  })

  it('does not replace a non-empty draft', async () => {
    const { apply, focus } = renderFill('topic-1', 'already typed')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
      flushAnimationFrames()
    })

    expect(apply).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })

  it('cancels a pending focus callback on unmount so a destroyed editor is never focused', async () => {
    const { apply, focus, unmount } = renderFill('topic-1', '')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
    })
    expect(apply).toHaveBeenCalledWith('Use this prompt')
    expect(focus).not.toHaveBeenCalled()

    unmount()
    await act(async () => {
      flushAnimationFrames()
    })

    expect(focus).not.toHaveBeenCalled()
  })

  it('does not focus a remounted composer from a previous instance pending frame', async () => {
    const first = renderFill('topic-1', '')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
    })
    expect(first.apply).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderFill('topic-1', '')
    await act(async () => {
      flushAnimationFrames()
    })

    expect(first.focus).not.toHaveBeenCalled()
    expect(second.focus).not.toHaveBeenCalled()
    expect(second.apply).not.toHaveBeenCalled()
  })

  it('fills a chip-only knowledge or skill draft whose serialized promptText is not user-typed text', async () => {
    const knowledgePrompt =
      'The user attached knowledge base "Knowledge One" (id: kb-1). Include "kb-1" in kb_search baseIds before answering questions that may depend on this knowledge base, and cite relevant kb_search or kb_read results. Use kb_list only to browse its structure; kb_list output is not retrieved evidence.'
    const { apply, focus } = renderFill('topic-1', {
      text: knowledgePrompt,
      tokens: [
        {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Knowledge One',
          promptText: knowledgePrompt,
          index: 0,
          textOffset: 0
        }
      ]
    })

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Clarify the problem' })
      flushAnimationFrames()
    })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('Clarify the problem')
    expect(focus).toHaveBeenCalledWith('end')
  })

  it('fills an empty parked draft while the visible overlay shows history text', async () => {
    const { apply, focus } = renderFill('topic-1', 'previous chat prompt', () => ({ text: '', tokens: [] }))

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
      flushAnimationFrames()
    })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('Use this prompt')
    expect(focus).toHaveBeenCalledWith('end')
  })

  it('does not replace a typed parked draft while the visible overlay shows history text', async () => {
    const { apply, focus } = renderFill('topic-1', 'previous chat prompt', () => ({
      text: 'already typed',
      tokens: []
    }))

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Use this prompt' })
      flushAnimationFrames()
    })

    expect(apply).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })

  it('still leaves a draft with real user-typed text next to chips untouched', async () => {
    const knowledgePrompt =
      'The user attached knowledge base "Knowledge One" (id: kb-1). Include "kb-1" in kb_search baseIds before answering questions that may depend on this knowledge base, and cite relevant kb_search or kb_read results. Use kb_list only to browse its structure; kb_list output is not retrieved evidence.'
    const { apply, focus } = renderFill('topic-1', {
      text: `${knowledgePrompt} already typed`,
      tokens: [
        {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Knowledge One',
          promptText: knowledgePrompt,
          index: 0,
          textOffset: 0
        }
      ]
    })

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.FILL_CHAT_COMPOSER, { topicId: 'topic-1', text: 'Clarify the problem' })
      flushAnimationFrames()
    })

    expect(apply).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })
})
