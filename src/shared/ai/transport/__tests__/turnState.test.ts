import { describe, expect, it } from 'vitest'

import { ConversationStatus } from '../../conversation'
import { classifyTurn, TURN_STATE, type TurnStateFlags } from '../turnState'

const ALL_STATUSES = Object.values(ConversationStatus)

describe('classifyTurn / TURN_STATE', () => {
  it('defines exactly one classification for every ConversationStatus', () => {
    expect(Object.keys(TURN_STATE).sort()).toEqual([...ALL_STATUSES].sort())
    for (const status of ALL_STATUSES) {
      expect(classifyTurn(status)).toBe(TURN_STATE[status])
    }
  })

  it('classifies a missing Conversation as inactive', () => {
    expect(classifyTurn(undefined)).toEqual<TurnStateFlags>({
      isStreamLive: false,
      isTurnActive: false,
      isAwaitingInteraction: false,
      isTerminal: false
    })
  })

  it.each([
    [ConversationStatus.Pending, true, true, false, false],
    [ConversationStatus.Streaming, true, true, false, false],
    [ConversationStatus.Done, false, false, false, true],
    [ConversationStatus.Aborted, false, false, false, true],
    [ConversationStatus.Error, false, false, false, true],
    [ConversationStatus.AwaitingInteraction, false, true, true, true]
  ] as const)(
    '%s exposes the promised live, active, interaction, and terminal flags',
    (status, isStreamLive, isTurnActive, isAwaitingInteraction, isTerminal) => {
      expect(classifyTurn(status)).toEqual({
        isStreamLive,
        isTurnActive,
        isAwaitingInteraction,
        isTerminal
      })
    }
  )
})
