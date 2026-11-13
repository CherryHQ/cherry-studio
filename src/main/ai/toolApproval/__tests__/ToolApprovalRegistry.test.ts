import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DispatchDecision } from '../ToolApprovalRegistry'
import { toolApprovalRegistry } from '../ToolApprovalRegistry'

let seq = 0

/** Build a pending-approval entry whose resolved `DispatchDecision` is awaitable. */
function makeEntry(overrides: Record<string, unknown> = {}) {
  const approvalId = `ap-${seq++}`
  let resolve!: (d: DispatchDecision) => void
  const result = new Promise<DispatchDecision>((res) => {
    resolve = res
  })
  const entry = {
    approvalId,
    sessionId: 's1',
    toolCallId: 'tc1',
    toolName: 'bash',
    originalInput: { cmd: 'ls' },
    presentation: 'stream' as const,
    resolve,
    ...overrides
  }
  return { entry, result, approvalId }
}

describe('ToolApprovalRegistry (driver-neutral)', () => {
  beforeEach(() => {
    toolApprovalRegistry.clear('test-reset')
  })

  it('resolves a dispatch with the exact decision, unmodified', async () => {
    const { entry, result, approvalId } = makeEntry()
    expect(toolApprovalRegistry.register(entry)).toBe(true)
    expect(toolApprovalRegistry.size()).toBe(1)

    expect(toolApprovalRegistry.dispatch(approvalId, { approved: true })).toEqual({
      sessionId: 's1',
      toolCallId: 'tc1',
      presentation: 'stream'
    })
    await expect(result).resolves.toEqual({ approved: true })
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it('passes updatedInput through untouched (mapping is the driver’s job)', async () => {
    const { entry, result, approvalId } = makeEntry()
    toolApprovalRegistry.register(entry)

    toolApprovalRegistry.dispatch(approvalId, { approved: true, updatedInput: { cmd: 'pwd' } })
    await expect(result).resolves.toEqual({ approved: true, updatedInput: { cmd: 'pwd' } })
  })

  it('resolves a denied dispatch with the supplied reason', async () => {
    const { entry, result, approvalId } = makeEntry()
    toolApprovalRegistry.register(entry)

    toolApprovalRegistry.dispatch(approvalId, { approved: false, reason: 'nope' })
    await expect(result).resolves.toEqual({ approved: false, reason: 'nope' })
  })

  it('returns undefined dispatching an unknown id (already settled / expired)', () => {
    expect(toolApprovalRegistry.dispatch('missing', { approved: true })).toBeUndefined()
  })

  it('rejects a duplicate registration without disturbing the first', async () => {
    const first = makeEntry()
    toolApprovalRegistry.register(first.entry)

    const dup = makeEntry({ approvalId: first.approvalId })
    expect(toolApprovalRegistry.register(dup.entry)).toBe(false)

    await expect(dup.result).resolves.toEqual({ approved: false, reason: 'Duplicate approval registration' })
    expect(toolApprovalRegistry.size()).toBe(1)

    toolApprovalRegistry.dispatch(first.approvalId, { approved: true })
    await expect(first.result).resolves.toMatchObject({ approved: true })
  })

  it('denies immediately when the signal is already aborted at registration', async () => {
    const controller = new AbortController()
    controller.abort()
    const { entry, result } = makeEntry({ signal: controller.signal })
    expect(toolApprovalRegistry.register(entry)).toBe(false)

    await expect(result).resolves.toEqual({
      approved: false,
      reason: 'Tool request was cancelled before approval'
    })
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it('denies a pending approval when its signal aborts later', async () => {
    const controller = new AbortController()
    const { entry, result } = makeEntry({ signal: controller.signal })
    toolApprovalRegistry.register(entry)
    expect(toolApprovalRegistry.size()).toBe(1)

    controller.abort()
    await expect(result).resolves.toEqual({ approved: false, reason: 'aborted' })
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  // A parked card whose waiter was cancelled must still be retired by onAborted listeners.
  it('notifies onAborted when a signal aborts, but not when the user decides', () => {
    const aborted: string[] = []
    const subscription = toolApprovalRegistry.onAborted((entry) => aborted.push(entry.approvalId))
    const controller = new AbortController()
    const cancelled = makeEntry({ signal: controller.signal, presentation: 'message' })
    const answered = makeEntry({ signal: new AbortController().signal, presentation: 'message' })
    toolApprovalRegistry.register(cancelled.entry)
    toolApprovalRegistry.register(answered.entry)

    controller.abort()
    toolApprovalRegistry.dispatch(answered.approvalId, { approved: true })
    subscription.dispose()

    expect(aborted).toEqual([cancelled.approvalId])
  })

  it.each(['signal', 'session'] as const)('notifies once when %s cancellation arrives first', async (first) => {
    const controller = new AbortController()
    const { entry, result, approvalId } = makeEntry({ signal: controller.signal, presentation: 'message' })
    const aborted: { approvalId: string; reason: string }[] = []
    const subscription = toolApprovalRegistry.onAborted(({ approvalId, reason }) => {
      aborted.push({ approvalId, reason })
    })

    try {
      toolApprovalRegistry.register(entry)
      if (first === 'signal') {
        controller.abort()
        expect(toolApprovalRegistry.abort(entry.sessionId)).toBe(0)
      } else {
        expect(toolApprovalRegistry.abort(entry.sessionId)).toBe(1)
        controller.abort()
      }

      const reason = first === 'signal' ? 'aborted' : 'session-aborted'
      expect(aborted).toEqual([{ approvalId, reason }])
      await expect(result).resolves.toEqual({ approved: false, reason })
      expect(toolApprovalRegistry.peek(approvalId)).toBeUndefined()
    } finally {
      subscription.dispose()
    }
  })

  it('aborts only the matching session and reports the count', async () => {
    const a = makeEntry({ sessionId: 'sA' })
    const b = makeEntry({ sessionId: 'sA' })
    const c = makeEntry({ sessionId: 'sB' })
    toolApprovalRegistry.register(a.entry)
    toolApprovalRegistry.register(b.entry)
    toolApprovalRegistry.register(c.entry)

    expect(toolApprovalRegistry.abort('sA', 'stop-sA')).toBe(2)
    await expect(a.result).resolves.toEqual({ approved: false, reason: 'stop-sA' })
    await expect(b.result).resolves.toEqual({ approved: false, reason: 'stop-sA' })

    expect(toolApprovalRegistry.size()).toBe(1)
    toolApprovalRegistry.dispatch(c.approvalId, { approved: true })
    await expect(c.result).resolves.toMatchObject({ approved: true })
  })

  it('clear() denies every pending approval and returns the count', async () => {
    const a = makeEntry()
    const b = makeEntry()
    toolApprovalRegistry.register(a.entry)
    toolApprovalRegistry.register(b.entry)

    expect(toolApprovalRegistry.clear('shutdown')).toBe(2)
    await expect(a.result).resolves.toEqual({ approved: false, reason: 'shutdown' })
    await expect(b.result).resolves.toEqual({ approved: false, reason: 'shutdown' })
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it('notifies after a clear sweep so listeners can register a new approval', async () => {
    const first = makeEntry()
    const second = makeEntry()
    const replacement = makeEntry({ approvalId: second.approvalId })
    toolApprovalRegistry.register(first.entry)
    toolApprovalRegistry.register(second.entry)
    const aborted: string[] = []
    const subscription = toolApprovalRegistry.onAborted(({ approvalId }) => {
      aborted.push(approvalId)
      if (approvalId === first.approvalId) toolApprovalRegistry.register(replacement.entry)
    })

    try {
      expect(toolApprovalRegistry.clear()).toBe(2)
      expect(aborted).toEqual([first.approvalId, second.approvalId])
      expect(toolApprovalRegistry.dispatch(second.approvalId, { approved: true })).toBeDefined()
      await expect(replacement.result).resolves.toEqual({ approved: true })
    } finally {
      subscription.dispose()
    }
  })

  it('clear() is a no-op (returns 0) when nothing is pending', () => {
    expect(toolApprovalRegistry.clear()).toBe(0)
  })
})

it('dispatches cancellation to each pending entry exactly once', async () => {
  const first = makeEntry()
  const second = makeEntry()
  toolApprovalRegistry.register(first.entry)
  toolApprovalRegistry.register(second.entry)
  expect(toolApprovalRegistry.abort('s1', 'stop')).toBe(2)
  expect(toolApprovalRegistry.abort('s1', 'stop')).toBe(0)
  await expect(first.result).resolves.toEqual({ approved: false, reason: 'stop' })
  await expect(second.result).resolves.toEqual({ approved: false, reason: 'stop' })
})

it('logs each cancellation once without question content', () => {
  toolApprovalRegistry.clear('test-reset')
  mockMainLoggerService.info.mockClear()
  const sentinel = 'private-question-options-answers'
  const cancelled = makeEntry({
    toolName: 'AskUserQuestion',
    originalInput: { questions: [{ question: sentinel, options: [sentinel] }], answers: sentinel }
  })
  const decided = makeEntry({ sessionId: 'decided', originalInput: { answers: sentinel } })
  toolApprovalRegistry.register(cancelled.entry)
  toolApprovalRegistry.register(decided.entry)
  toolApprovalRegistry.dispatch(decided.approvalId, { approved: true, updatedInput: { answers: sentinel } })
  toolApprovalRegistry.abort('decided', 'stop')
  toolApprovalRegistry.abort('s1', 'stop')
  toolApprovalRegistry.abort('s1', 'stop')
  const records = mockMainLoggerService.info.mock.calls.filter(([message]) => message === 'Tool approval cancelled')
  expect(records).toEqual([
    [
      'Tool approval cancelled',
      {
        sessionId: 's1',
        approvalId: cancelled.approvalId,
        toolCallId: 'tc1',
        toolName: 'AskUserQuestion',
        reason: 'stop'
      }
    ]
  ])
  expect(JSON.stringify(records)).not.toContain(sentinel)
})
