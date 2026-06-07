import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ──────────────────────────────────────────────────────────────────────────
// SCOPE: these assert the ORDERING — for a streaming branch the fork-topic
// delete WAITS for the existing MESSAGE_COMPLETE event (which fires after the
// aborted stream's finalize PATCH lands) before deleting. The actual "no 404 /
// no unhandled rejection" depends on the real finalize PATCH race and is
// real-app MANUAL-SMOKE; jsdom can't reproduce it.
// ──────────────────────────────────────────────────────────────────────────

let captured: ((payload: unknown) => void) | undefined
const mocks = vi.hoisted(() => ({ on: vi.fn(), unsubscribe: vi.fn() }))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { MESSAGE_COMPLETE: 'MESSAGE_COMPLETE' },
  EventEmitter: { on: mocks.on }
}))

import { scheduleForkTopicDeletion } from '../scheduleForkTopicDeletion'

beforeEach(() => {
  vi.clearAllMocks()
  captured = undefined
  mocks.on.mockImplementation((_name: string, handler: (p: unknown) => void) => {
    captured = handler
    return mocks.unsubscribe
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleForkTopicDeletion (P1-S3 delete-after-settle)', () => {
  it('NON-streaming (no aborted messages): deletes immediately, registers no listener', () => {
    const del = vi.fn()
    scheduleForkTopicDeletion('topic-X', [], del)
    expect(del).toHaveBeenCalledExactlyOnceWith('topic-X')
    expect(mocks.on).not.toHaveBeenCalled()
  })

  it('STREAMING: does NOT delete synchronously; deletes only after MESSAGE_COMPLETE for that topic', () => {
    const del = vi.fn()
    scheduleForkTopicDeletion('topic-X', ['msg-1'], del)
    // The ordering guarantee: not deleted on close.
    expect(del).not.toHaveBeenCalled()
    expect(mocks.on).toHaveBeenCalledTimes(1)

    // finalize lands → MESSAGE_COMPLETE for this topic's aborted message.
    captured?.({ topicId: 'topic-X', id: 'msg-1', status: 'pause' })
    expect(del).toHaveBeenCalledExactlyOnceWith('topic-X')
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1) // one-shot listener cleaned up
  })

  it('ignores MESSAGE_COMPLETE for OTHER topics (app-wide event, match this branch only)', () => {
    const del = vi.fn()
    scheduleForkTopicDeletion('topic-X', ['msg-1'], del)
    captured?.({ topicId: 'topic-OTHER', id: 'msg-1', status: 'success' })
    expect(del).not.toHaveBeenCalled()
  })

  it('multiple in-flight messages: deletes only after ALL aborted messages settle', () => {
    const del = vi.fn()
    scheduleForkTopicDeletion('topic-X', ['msg-1', 'msg-2'], del)
    captured?.({ topicId: 'topic-X', id: 'msg-1', status: 'pause' })
    expect(del).not.toHaveBeenCalled() // still waiting for msg-2
    captured?.({ topicId: 'topic-X', id: 'msg-2', status: 'pause' })
    expect(del).toHaveBeenCalledExactlyOnceWith('topic-X')
  })

  it('FALLBACK TIMEOUT: if the event never arrives, deletes anyway (never leak an orphan) + cleans up', () => {
    vi.useFakeTimers()
    const del = vi.fn()
    scheduleForkTopicDeletion('topic-X', ['msg-1'], del, 5000)
    expect(del).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(del).toHaveBeenCalledExactlyOnceWith('topic-X')
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not double-delete: event after timeout (or vice versa) deletes only once', () => {
    vi.useFakeTimers()
    const del = vi.fn()
    scheduleForkTopicDeletion('topic-X', ['msg-1'], del, 5000)
    vi.advanceTimersByTime(5000) // timeout fires → delete
    captured?.({ topicId: 'topic-X', id: 'msg-1', status: 'pause' }) // late event
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('returned cleanup removes the listener (no lingering subscription)', () => {
    const del = vi.fn()
    const cleanup = scheduleForkTopicDeletion('topic-X', ['msg-1'], del)
    cleanup()
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
