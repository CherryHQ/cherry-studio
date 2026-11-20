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

  it('executes the approved arguments once even after a wire round trip', async () => {
    const input = toolApprovalRegistry.bindInvocation({
      sessionId: 's1',
      toolName: 'load',
      input: { target: 'server', options: { path: 'skill' } },
      signal: new AbortController().signal,
      validate: () => {}
    })
    const request = {
      sessionId: 's1',
      toolName: 'load',
      input: JSON.parse(JSON.stringify(input)),
      signal: new AbortController().signal,
      permissionMode: 'default' as const
    }
    let executions = 0
    const run = async () => ++executions
    await expect(toolApprovalRegistry.runApprovedInvocation(request, run)).resolves.toBe(1)
    await expect(toolApprovalRegistry.runApprovedInvocation(request, run)).rejects.toThrow()
    expect(executions).toBe(1)
  })

  it.each(['session', 'tool', 'arguments', 'mutated-original'] as const)(
    'rejects changed %s before execution',
    async (change) => {
      const original = { target: 'server', options: { path: 'skill' } }
      const input = toolApprovalRegistry.bindInvocation({
        sessionId: 's1',
        toolName: 'load',
        input: original,
        signal: new AbortController().signal,
        validate: () => {}
      })
      if (change === 'mutated-original') original.options.path = 'another'
      let executed = false
      await expect(
        toolApprovalRegistry.runApprovedInvocation(
          {
            sessionId: change === 'session' ? 's2' : 's1',
            toolName: change === 'tool' ? 'install' : 'load',
            input: change === 'arguments' ? { ...input, target: 'other' } : input,
            signal: new AbortController().signal,
            permissionMode: 'default'
          },
          async () => {
            executed = true
          }
        )
      ).rejects.toThrow()
      expect(executed).toBe(false)
    }
  )

  it.each(['signal', 'session', 'shutdown'] as const)(
    'revokes an unused approved invocation on %s cancellation',
    async (reason) => {
      const abort = new AbortController()
      const input = toolApprovalRegistry.bindInvocation({
        sessionId: 's1',
        toolName: 'load',
        input: { target: 'server' },
        signal: abort.signal,
        validate: () => {}
      })
      if (reason === 'signal') abort.abort()
      else if (reason === 'session') toolApprovalRegistry.abort('s1')
      else toolApprovalRegistry.clear()
      let executed = false
      await expect(
        toolApprovalRegistry.runApprovedInvocation(
          {
            sessionId: 's1',
            toolName: 'load',
            input,
            signal: new AbortController().signal,
            permissionMode: 'default'
          },
          async () => {
            executed = true
          }
        )
      ).rejects.toThrow()
      expect(executed).toBe(false)
    }
  )

  it('rejects a late result when its approved context changes during execution', async () => {
    const abort = new AbortController()
    const input = toolApprovalRegistry.bindInvocation({
      sessionId: 's1',
      toolName: 'load',
      input: { target: 'server' },
      signal: abort.signal,
      validate: () => {}
    })
    await expect(
      toolApprovalRegistry.runApprovedInvocation(
        {
          sessionId: 's1',
          toolName: 'load',
          input,
          signal: new AbortController().signal,
          permissionMode: 'default'
        },
        async () => {
          abort.abort()
          return 'superseded content'
        }
      )
    ).rejects.toThrow()
  })

  it('requires a receipt in ordinary mode and permits Full Access without one', async () => {
    const request = {
      sessionId: 's1',
      toolName: 'load',
      input: { target: 'server' },
      signal: new AbortController().signal
    }
    let executions = 0
    const run = async () => ++executions
    await expect(
      toolApprovalRegistry.runApprovedInvocation({ ...request, permissionMode: 'default' }, run)
    ).rejects.toThrow()
    await expect(
      toolApprovalRegistry.runApprovedInvocation({ ...request, permissionMode: 'bypassPermissions' }, run)
    ).resolves.toBe(1)
    expect(executions).toBe(1)
  })
})
