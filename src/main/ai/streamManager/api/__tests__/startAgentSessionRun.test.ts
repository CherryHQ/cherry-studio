import {
  ConversationAdmissionReason,
  ConversationBlockReason,
  ConversationKind,
  ConversationOpenMode,
  toConversationExecutionId,
  toConversationInputId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationAdmissionError } from '../../../conversation'
import type { StreamListener } from '../../types'

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name !== 'ConversationRuntimeService') throw new Error(`Unexpected service: ${name}`)
      return { dispatch }
    }
  }
}))

const { startAgentSessionRun, StartAgentSessionRunMode, StartAgentSessionRunRejection } = await import(
  '../startAgentSessionRun'
)

const turnId = toConversationTurnId('turn-1')
const inputId = toConversationInputId('input-1')
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
  })

  it('returns the exact turn identity for a Started run', async () => {
    dispatch.mockResolvedValueOnce({
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

    await expect(
      startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [listener] })
    ).resolves.toEqual({ mode: StartAgentSessionRunMode.Started, turnId })
  })

  it('returns the accepted input identity without claiming the active turn for an Injected run', async () => {
    dispatch.mockResolvedValueOnce({ mode: ConversationOpenMode.Injected, inputId })

    await expect(
      startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [listener] })
    ).resolves.toEqual({ mode: StartAgentSessionRunMode.Injected, inputId })
  })

  it('forwards extra listeners in caller order', async () => {
    const extra = { ...listener, id: 'extra' }
    dispatch.mockResolvedValue({
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

    await startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [listener, extra] })

    expect(dispatch).toHaveBeenCalledWith(listener, expect.any(Object), [extra], {})
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

  it('maps an atomic require-idle busy rejection to Blocked', async () => {
    dispatch.mockRejectedValue(new ConversationAdmissionError(ConversationAdmissionReason.ConversationBusy))

    await expect(
      startAgentSessionRun({
        sessionId: 'session-1',
        userParts: [],
        listeners: [listener],
        requireIdle: { expectedAgentId: 'agent-1' }
      })
    ).resolves.toEqual({ mode: StartAgentSessionRunMode.Blocked, reason: StartAgentSessionRunRejection.Busy })
  })

  it('maps workspace and stale-session ownership failures without writing a fallback result', async () => {
    dispatch
      .mockResolvedValueOnce({
        mode: ConversationOpenMode.Blocked,
        reason: ConversationBlockReason.AgentSessionWorkspace,
        message: 'workspace unavailable'
      })
      .mockRejectedValueOnce(DataApiErrorFactory.notFound('Session', 'session-1'))

    await expect(
      startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [listener] })
    ).resolves.toEqual({
      mode: StartAgentSessionRunMode.Blocked,
      reason: StartAgentSessionRunRejection.SessionInvalid
    })
    await expect(
      startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [listener] })
    ).resolves.toEqual({
      mode: StartAgentSessionRunMode.Blocked,
      reason: StartAgentSessionRunRejection.SessionInvalid
    })
  })

  it('rejects a caller that cannot observe terminal completion', async () => {
    await expect(startAgentSessionRun({ sessionId: 'session-1', userParts: [], listeners: [] })).rejects.toThrow(
      'requires at least one listener'
    )
    expect(dispatch).not.toHaveBeenCalled()
  })
})
