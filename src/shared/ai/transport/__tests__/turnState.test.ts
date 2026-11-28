import { describe, expect, it } from 'vitest'

import type { TopicStreamStatus } from '../stream'
import { classifyTurn, type TurnStateFlags } from '../turnState'

describe('classifyTurn / TURN_STATE', () => {
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
})
