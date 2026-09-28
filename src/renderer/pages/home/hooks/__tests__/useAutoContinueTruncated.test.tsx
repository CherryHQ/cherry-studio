import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { useAutoContinueTruncated } from '../useAutoContinueTruncated'

let enabled = true

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [enabled, vi.fn()]
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

function assistant(overrides: { id?: string; finishReason?: string; status?: string } = {}): CherryUIMessage {
  return {
    id: overrides.id ?? 'a1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'half an answ' }],
    metadata: {
      status: overrides.status ?? 'success',
      ...(overrides.finishReason ? { stats: { finishReason: overrides.finishReason } } : {})
    }
  } as unknown as CherryUIMessage
}

function renderWatcher(continueTruncated: (id: string) => Promise<void>, messages: CherryUIMessage[]) {
  return renderHook(
    ({ isStreamPending, msgs }: { isStreamPending: boolean; msgs: CherryUIMessage[] }) =>
      useAutoContinueTruncated({ topicId: 'topic-1', messages: msgs, isStreamPending, continueTruncated }),
    { initialProps: { isStreamPending: true, msgs: messages } }
  )
}

describe('useAutoContinueTruncated', () => {
  let continueTruncated: ReturnType<typeof makeContinue>

  const makeContinue = () => vi.fn<(messageId: string) => Promise<void>>(async () => {})

  beforeEach(() => {
    vi.clearAllMocks()
    enabled = true
    continueTruncated = makeContinue()
  })

  it('carries on a reply the provider stopped at its token cap', () => {
    const messages = [assistant({ finishReason: 'length' })]
    const { rerender } = renderWatcher(continueTruncated, messages)

    rerender({ isStreamPending: false, msgs: messages })

    expect(continueTruncated).toHaveBeenCalledWith('a1')
  })

  it('leaves a reply that ended on its own alone', () => {
    const messages = [assistant({ finishReason: 'stop' })]
    const { rerender } = renderWatcher(continueTruncated, messages)

    rerender({ isStreamPending: false, msgs: messages })

    expect(continueTruncated).not.toHaveBeenCalled()
  })

  it('stops after three tries so a model that keeps stalling cannot drain the quota', () => {
    const messages = [assistant({ finishReason: 'length' })]
    const { rerender } = renderWatcher(continueTruncated, messages)

    for (let i = 0; i < 5; i++) {
      rerender({ isStreamPending: true, msgs: messages })
      rerender({ isStreamPending: false, msgs: messages })
    }

    expect(continueTruncated).toHaveBeenCalledTimes(3)
  })

  it('sends nothing when opening a topic that already holds a truncated reply', () => {
    // No pending→settled transition was observed here: the turn finished before this mounted.
    const messages = [assistant({ finishReason: 'length' })]
    renderHook(() =>
      useAutoContinueTruncated({ topicId: 'topic-1', messages, isStreamPending: false, continueTruncated })
    )

    expect(continueTruncated).not.toHaveBeenCalled()
  })

  it('does not treat a topic switch as a turn that just finished', () => {
    const messages = [assistant({ finishReason: 'length' })]
    const { rerender } = renderHook(
      ({ topicId, isStreamPending }: { topicId: string; isStreamPending: boolean }) =>
        useAutoContinueTruncated({ topicId, messages, isStreamPending, continueTruncated }),
      { initialProps: { topicId: 'topic-1', isStreamPending: true } }
    )

    rerender({ topicId: 'topic-2', isStreamPending: false })

    expect(continueTruncated).not.toHaveBeenCalled()
  })

  it('does not continue a reply that failed', () => {
    const messages = [assistant({ finishReason: 'length', status: 'error' })]
    const { rerender } = renderWatcher(continueTruncated, messages)

    rerender({ isStreamPending: false, msgs: messages })

    expect(continueTruncated).not.toHaveBeenCalled()
  })

  it('sends nothing when the user turned it off', () => {
    enabled = false
    const messages = [assistant({ finishReason: 'length' })]
    const { rerender } = renderWatcher(continueTruncated, messages)

    rerender({ isStreamPending: false, msgs: messages })

    expect(continueTruncated).not.toHaveBeenCalled()
  })
})
