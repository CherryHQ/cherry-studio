import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it } from 'vitest'

import { toolApprovalRegistry } from '../ToolApprovalRegistry'

let seq = 0

/** Build a pending-approval entry whose resolved `PermissionResult` is awaitable. */
function makeEntry(overrides: Record<string, unknown> = {}) {
  const approvalId = `ap-${seq++}`
  let resolve!: (r: PermissionResult) => void
  const result = new Promise<PermissionResult>((res) => {
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

describe('ToolApprovalRegistry', () => {
  beforeEach(() => {
    toolApprovalRegistry.clear('test-reset')
  })

  it('resolves an approved dispatch with allow + the original input by default', async () => {
    const { entry, result, approvalId } = makeEntry()
    toolApprovalRegistry.register(entry)
    expect(toolApprovalRegistry.size()).toBe(1)

    expect(toolApprovalRegistry.dispatch(approvalId, { approved: true })).toBe(true)
    await expect(result).resolves.toEqual({ behavior: 'allow', updatedInput: { cmd: 'ls' } })
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it('resolves an approved dispatch with the updatedInput override when provided', async () => {
    const { entry, result, approvalId } = makeEntry()
    toolApprovalRegistry.register(entry)

    toolApprovalRegistry.dispatch(approvalId, { approved: true, updatedInput: { cmd: 'pwd' } })
    await expect(result).resolves.toEqual({ behavior: 'allow', updatedInput: { cmd: 'pwd' } })
  })

  it('resolves a denied dispatch with deny + the supplied reason', async () => {
    const { entry, result, approvalId } = makeEntry()
    toolApprovalRegistry.register(entry)

    toolApprovalRegistry.dispatch(approvalId, { approved: false, reason: 'nope' })
    await expect(result).resolves.toEqual({ behavior: 'deny', message: 'nope' })
  })

  it('returns false dispatching an unknown id (already settled / expired)', () => {
    expect(toolApprovalRegistry.dispatch('missing', { approved: true })).toBe(false)
  })

  it('rejects a duplicate registration without disturbing the first', async () => {
    const first = makeEntry()
    toolApprovalRegistry.register(first.entry)

    const dup = makeEntry({ approvalId: first.approvalId })
    toolApprovalRegistry.register(dup.entry)

    // The duplicate is denied immediately; the original stays pending.
    await expect(dup.result).resolves.toEqual({
      behavior: 'deny',
      message: 'Duplicate approval registration'
    })
    expect(toolApprovalRegistry.size()).toBe(1)

    toolApprovalRegistry.dispatch(first.approvalId, { approved: true })
    await expect(first.result).resolves.toMatchObject({ behavior: 'allow' })
  })

  it('denies immediately when the signal is already aborted at registration', async () => {
    const controller = new AbortController()
    controller.abort()
    const { entry, result } = makeEntry({ signal: controller.signal })
    toolApprovalRegistry.register(entry)

    await expect(result).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool request was cancelled before approval'
    })
    // Never stored.
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it('denies a pending approval when its signal aborts later', async () => {
    const controller = new AbortController()
    const { entry, result } = makeEntry({ signal: controller.signal })
    toolApprovalRegistry.register(entry)
    expect(toolApprovalRegistry.size()).toBe(1)

    controller.abort()
    await expect(result).resolves.toEqual({ behavior: 'deny', message: 'aborted' })
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
    await expect(a.result).resolves.toEqual({ behavior: 'deny', message: 'stop-sA' })
    await expect(b.result).resolves.toEqual({ behavior: 'deny', message: 'stop-sA' })

    // sB untouched.
    expect(toolApprovalRegistry.size()).toBe(1)
    toolApprovalRegistry.dispatch(c.approvalId, { approved: true })
    await expect(c.result).resolves.toMatchObject({ behavior: 'allow' })
  })

  it('clear() denies every pending approval and returns the count', async () => {
    const a = makeEntry()
    const b = makeEntry()
    toolApprovalRegistry.register(a.entry)
    toolApprovalRegistry.register(b.entry)

    expect(toolApprovalRegistry.clear('shutdown')).toBe(2)
    await expect(a.result).resolves.toEqual({ behavior: 'deny', message: 'shutdown' })
    await expect(b.result).resolves.toEqual({ behavior: 'deny', message: 'shutdown' })
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it('clear() is a no-op (returns 0) when nothing is pending', () => {
    expect(toolApprovalRegistry.clear()).toBe(0)
  })
})
