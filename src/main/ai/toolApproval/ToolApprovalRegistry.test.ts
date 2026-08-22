import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

const { toolApprovalRegistry } = await import('./ToolApprovalRegistry')

type Settlement = {
  approvalId: string
  sessionId: string
  toolCallId: string
  presentation: 'stream' | 'message'
  decision: { approved: boolean; reason?: string; updatedInput?: Record<string, unknown> }
}

function registerPending(approvalId: string, sessionId = 'session-1', signal?: AbortSignal) {
  const resolve = vi.fn()
  const registered = toolApprovalRegistry.register({
    approvalId,
    sessionId,
    toolCallId: `tool-${approvalId}`,
    toolName: 'AskUserQuestion',
    originalInput: {},
    presentation: 'message',
    resolve,
    ...(signal ? { signal } : {})
  })
  return { registered, resolve }
}

describe('ToolApprovalRegistry settlement notifications', () => {
  let settlements: Settlement[]

  beforeEach(() => {
    // Clear BEFORE attaching the fresh listener so settlements left over by an
    // earlier test (the singleton outlives tests) don't leak into this one.
    toolApprovalRegistry.clear('test-reset')
    settlements = []
    toolApprovalRegistry.onSettlement((settlement) => settlements.push(settlement))
  })

  it('notifies the settlement listener when a renderer response dispatches', () => {
    const { resolve } = registerPending('approval-1')

    const registration = toolApprovalRegistry.dispatch('approval-1', { approved: true })

    expect(resolve).toHaveBeenCalledWith({ approved: true })
    expect(registration?.sessionId).toBe('session-1')
    expect(settlements).toEqual([
      {
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-approval-1',
        presentation: 'message',
        decision: { approved: true }
      }
    ])
  })

  it('notifies per entry on session abort and leaves other sessions pending', () => {
    registerPending('approval-1', 'session-1')
    registerPending('approval-2', 'session-2')

    expect(toolApprovalRegistry.abort('session-1', 'stream-ended')).toBe(1)

    expect(settlements).toHaveLength(1)
    expect(settlements[0]).toMatchObject({
      approvalId: 'approval-1',
      sessionId: 'session-1',
      decision: { approved: false, reason: 'stream-ended' }
    })
    // The other session's approval is untouched and still dispatchable.
    expect(toolApprovalRegistry.peek('approval-2')).toBeDefined()
  })

  it('notifies every entry on clear', () => {
    registerPending('approval-1')
    registerPending('approval-2')

    expect(toolApprovalRegistry.clear('agent-session-runtime-stop')).toBe(2)
    expect(settlements.map((s) => s.approvalId)).toEqual(['approval-1', 'approval-2'])
    expect(settlements.every((s) => s.decision.reason === 'agent-session-runtime-stop')).toBe(true)
  })

  it('settles through the notification when the request signal aborts', () => {
    const controller = new AbortController()
    const { resolve } = registerPending('approval-1', 'session-1', controller.signal)

    controller.abort()

    expect(resolve).toHaveBeenCalledWith({ approved: false, reason: 'aborted' })
    expect(settlements).toEqual([
      expect.objectContaining({
        approvalId: 'approval-1',
        decision: { approved: false, reason: 'aborted' }
      })
    ])
  })

  it('keeps resolution working when the settlement listener throws', () => {
    const { resolve } = registerPending('approval-1')
    toolApprovalRegistry.onSettlement(() => {
      throw new Error('settle failed')
    })

    expect(toolApprovalRegistry.dispatch('approval-1', { approved: true })).toBeDefined()
    expect(resolve).toHaveBeenCalledWith({ approved: true })
  })
})
