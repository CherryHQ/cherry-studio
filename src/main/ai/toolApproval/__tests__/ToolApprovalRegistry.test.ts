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

  it('clear() is a no-op (returns 0) when nothing is pending', () => {
    expect(toolApprovalRegistry.clear()).toBe(0)
  })
  it('cancels only the exact id and detaches its abort listener', async () => {
    const controller = new AbortController()
    const a = makeEntry({ signal: controller.signal, presentation: 'message' })
    const b = makeEntry()
    const events: unknown[] = []
    const subscription = toolApprovalRegistry.onCancelled((event) => events.push(event))
    try {
      toolApprovalRegistry.register(a.entry)
      toolApprovalRegistry.register(b.entry)
      expect(toolApprovalRegistry.cancel(a.approvalId, 'connection closed')).toEqual({
        sessionId: 's1',
        toolCallId: 'tc1',
        presentation: 'message'
      })
      controller.abort()
      expect(toolApprovalRegistry.cancel(a.approvalId, 'again')).toBeUndefined()
      await expect(a.result).resolves.toEqual({ approved: false, reason: 'connection closed' })
      expect(events).toEqual([
        {
          approvalId: a.approvalId,
          sessionId: 's1',
          toolCallId: 'tc1',
          presentation: 'message',
          reason: 'connection closed'
        }
      ])
      expect(toolApprovalRegistry.size()).toBe(1)
      expect(toolApprovalRegistry.hasSession('s1')).toBe(true)
      expect(toolApprovalRegistry.peek(b.approvalId)).toBeDefined()
      toolApprovalRegistry.dispatch(b.approvalId, { approved: true })
      await expect(b.result).resolves.toEqual({ approved: true })
      expect(events).toHaveLength(1)
      expect(toolApprovalRegistry.hasSession('s1')).toBe(false)
    } finally {
      subscription.dispose()
    }
  })

  it.each(['signal', 'abort', 'clear', 'cancel'] as const)(
    'emits one cancellation for %s, never for user dispatch',
    async (action) => {
      const controller = new AbortController()
      const a = makeEntry({ signal: controller.signal, presentation: action === 'signal' ? 'stream' : 'message' })
      const events: unknown[] = []
      const subscription = toolApprovalRegistry.onCancelled((event) => events.push(event))
      try {
        toolApprovalRegistry.register(a.entry)
        if (action === 'signal') controller.abort()
        else if (action === 'abort') expect(toolApprovalRegistry.abort('s1', 'cancelled')).toBe(1)
        else if (action === 'clear') expect(toolApprovalRegistry.clear('cancelled')).toBe(1)
        else toolApprovalRegistry.cancel(a.approvalId, 'cancelled')
        const reason = action === 'signal' ? 'aborted' : 'cancelled'
        await expect(a.result).resolves.toEqual({ approved: false, reason })
        expect(events).toEqual([
          {
            approvalId: a.approvalId,
            sessionId: 's1',
            toolCallId: 'tc1',
            presentation: a.entry.presentation,
            reason
          }
        ])
        const user = makeEntry()
        toolApprovalRegistry.register(user.entry)
        toolApprovalRegistry.dispatch(user.approvalId, { approved: false, reason: 'user said no' })
        await expect(user.result).resolves.toEqual({ approved: false, reason: 'user said no' })
        expect(events).toHaveLength(1)
      } finally {
        subscription.dispose()
      }
    }
  )
})
