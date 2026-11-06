import type { AgentBeforeSettleEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { type PendingDelivery, SubagentDelivery } from '../src/subagentDelivery'

describe('delivery after a run the runtime aborts itself', () => {
  const result: PendingDelivery = {
    sessionId: 'sub-1',
    run: 1,
    description: 'Check A',
    outcome: 'completed',
    report: 'REPORT-A',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    wake: true
  }

  // Breaks when the user's stop is taken for the runtime's abort when both end one run (a goal
  // withdrawing a round): results would start a run the user just stopped.
  it.each([
    { userStop: false, starts: 1 },
    { userStop: true, starts: 0 }
  ])(
    'starts a run for a result unless the user also stopped that run (userStop: $userStop)',
    ({ userStop, starts }) => {
      const started: unknown[] = []
      const delivery = new SubagentDelivery({
        getBranch: () => [],
        startTurn: (message) => void started.push(message),
        isIdle: () => true,
        runningBackground: () => 0
      })
      delivery.expectRuntimeAbort()
      if (userStop) delivery.expectUserAbort()
      delivery.settled(true)
      delivery.enqueue(result)

      expect(started).toHaveLength(starts)
      // A held-back result rides with the user's next message.
      if (userStop) expect(delivery.beforeAgentStart()?.message.content).toContain('REPORT-A')
    }
  )

  // Confirmation must not remove another run that finishes while later boundary handlers await.
  it('confirms only committed runs and retains a later result from the same subagent', () => {
    const branch: SessionEntry[] = []
    const delivery = new SubagentDelivery({
      getBranch: () => branch,
      startTurn: () => {
        throw new Error('The parent is still running')
      },
      isIdle: () => false,
      runningBackground: () => 0
    })
    const event = {
      outcome: 'completed',
      entries: [],
      context: { pendingMessages: [] }
    } as unknown as AgentBeforeSettleEvent
    delivery.enqueue({ ...result })
    const draft = delivery.beforeSettle(event)!
    expect(delivery.pending().map((item) => item.run)).toEqual([1])
    delivery.enqueue({ ...result, run: 2, report: 'REPORT-B' })
    branch.push({
      ...draft.entries![0],
      id: 'committed',
      parentId: null,
      timestamp: new Date().toISOString()
    } as SessionEntry)
    delivery.settled(false)

    expect(delivery.pending().map((item) => item.run)).toEqual([2])
    const next = delivery.beforeAgentStart()!.message
    expect(next.content).toContain('REPORT-B')
    expect(next.content).not.toContain('REPORT-A')
  })
})
