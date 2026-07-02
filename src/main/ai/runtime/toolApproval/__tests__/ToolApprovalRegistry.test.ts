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

    expect(toolApprovalRegistry.dispatch(approvalId, { approved: true })).toBe(true)
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

  it('returns false dispatching an unknown id (already settled / expired)', () => {
    expect(toolApprovalRegistry.dispatch('missing', { approved: true })).toBe(false)
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
})
