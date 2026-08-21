import {
  ConversationBlockReason,
  ConversationKind,
  ConversationOpenMode,
  ConversationPhase,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'

const { dispatch, inspect } = vi.hoisted(() => ({ dispatch: vi.fn(), inspect: vi.fn() }))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name !== 'ConversationRuntimeService') throw new Error(`Unexpected service: ${name}`)
      return { dispatch, inspect }
    }
  }
}))

const { startAgentSessionRun, StartAgentSessionRunMode, StartAgentSessionRunRejection } = await import(
  '../startAgentSessionRun'
)

const turnId = toConversationTurnId('turn-1')
const listener: StreamListener = {
  id: 'test',
  onChunk: vi.fn(),
  onDone: vi.fn(),
  onPaused: vi.fn(),
  onError: vi.fn(),
  isAlive: () => true
}

describe('startAgentSessionRun', () => {
  beforeEach(() => {
    dispatch.mockReset()
    inspect.mockReset().mockReturnValue({
      ref: { kind: ConversationKind.Agent, id: 'session-1' },
      profile: { kind: ConversationKind.Agent },
      phase: ConversationPhase.Running,
      inbox: { nextTurn: [], nextStep: [] },
      activities: new Map(),
      turn: { id: turnId }
    })
  })

  it('returns the exact turn identity and preserves Started versus Injected', async () => {
    dispatch
      .mockResolvedValueOnce({
        mode: ConversationOpenMode.Started,
        activeExecutions: [
          {
            turnId,
            executionId: toConversationExecutionId('execution-1'),
            modelId: 'provider::model',
            outputNodeId: 'assistant-1'
          }
        ]
      })
      .mockResolvedValueOnce({ mode: ConversationOpenMode.Injected })

    await expect(
      startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [listener] })
    ).resolves.toEqual({ mode: StartAgentSessionRunMode.Started, turnId })
    await expect(
      startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [listener] })
    ).resolves.toEqual({ mode: StartAgentSessionRunMode.Injected, turnId })
  })

  it('keeps require-idle ownership inside the Conversation admission lane', async () => {
    dispatch.mockResolvedValue({ mode: ConversationOpenMode.Blocked, reason: ConversationBlockReason.Paused })

    await expect(
      startAgentSessionRun({
        sessionId: 'session-1',
        userParts: [],
        listeners: [listener],
        requireIdle: { expectedAgentId: 'agent-1' }
      })
    ).resolves.toEqual({ mode: StartAgentSessionRunMode.Blocked, reason: StartAgentSessionRunRejection.Paused })
    expect(dispatch).toHaveBeenCalledWith(
      listener,
      expect.objectContaining({ conversation: { kind: ConversationKind.Agent, id: 'session-1' } }),
      [],
      { requireIdle: true, expectedAgentId: 'agent-1' }
    )
  })
})
