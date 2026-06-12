import { describe, expect, it } from 'vitest'

import type { TopicStreamStatus } from '../stream'
import { classifyTurn, TURN_STATE, type TurnStateFlags } from '../turnState'

const ALL_STATUSES: TopicStreamStatus[] = ['pending', 'streaming', 'done', 'aborted', 'error', 'awaiting-approval']

describe('classifyTurn / TURN_STATE', () => {
  it('has a row for every TopicStreamStatus (exhaustive, no extras)', () => {
    expect(Object.keys(TURN_STATE).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('classifyTurn(status) returns the table row', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s)).toBe(TURN_STATE[s])
    }
  })

  it('classifyTurn(undefined) = no-stream (all flags false)', () => {
    expect(classifyTurn(undefined)).toEqual<TurnStateFlags>({
      isStreamLive: false,
      isTurnActive: false,
      isAwaitingApproval: false,
      isTerminal: false
    })
  })

  it.each<[TopicStreamStatus, TurnStateFlags]>([
    [
      'pending',
      {
        isStreamLive: true,
        isTurnActive: true,
        isAwaitingApproval: false,
        isTerminal: false
      }
    ],
    [
      'streaming',
      {
        isStreamLive: true,
        isTurnActive: true,
        isAwaitingApproval: false,
        isTerminal: false
      }
    ],
    [
      'done',
      {
        isStreamLive: false,
        isTurnActive: false,
        isAwaitingApproval: false,
        isTerminal: true
      }
    ],
    [
      'aborted',
      {
        isStreamLive: false,
        isTurnActive: false,
        isAwaitingApproval: false,
        isTerminal: true
      }
    ],
    [
      'error',
      {
        isStreamLive: false,
        isTurnActive: false,
        isAwaitingApproval: false,
        isTerminal: true
      }
    ],
    [
      'awaiting-approval',
      {
        isStreamLive: false,
        isTurnActive: true,
        isAwaitingApproval: true,
        isTerminal: true
      }
    ]
  ])('%s → expected flags', (status, expected) => {
    expect(classifyTurn(status)).toEqual(expected)
  })

  // Behavior-preservation guards for the Phase-0 consumer rewrites:
  it('isStreamLive == old (pending|streaming) — useTopicStreamStatus.isPending / Message.isTopicStreaming', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s).isStreamLive).toBe(s === 'pending' || s === 'streaming')
    }
  })

  it('isTerminal == old useChatWithHistory set (done|aborted|error|awaiting-approval)', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s).isTerminal).toBe(
        s === 'done' || s === 'aborted' || s === 'error' || s === 'awaiting-approval'
      )
    }
  })

  it('isAwaitingApproval == old useTopicAwaitingApproval (status === awaiting-approval)', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s).isAwaitingApproval).toBe(s === 'awaiting-approval')
    }
  })
})
