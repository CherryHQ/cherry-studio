import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import type { CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { uiToMessage } from '../uiToMessage'

const CTX = { assistantId: 'asst-1', topicId: 'topic-1' } as const
const GEMINI: ModelSnapshot = { id: 'gemini-3', name: 'Gemini 3', provider: 'google' }

function mk(overrides: Partial<CherryUIMessage>): CherryUIMessage {
  return { id: 'm-1', role: 'assistant', parts: [], metadata: {}, ...overrides } as CherryUIMessage
}

describe('uiToMessage', () => {
  it('projects a full DB-backed assistant message', () => {
    const msg = uiToMessage(
      mk({
        id: 'db-abc',
        role: 'assistant',
        metadata: {
          parentId: 'user-1',
          siblingsGroupId: 42,
          modelId: 'google::gemini-3',
          modelSnapshot: GEMINI,
          status: 'success',
          createdAt: '2026-04-24T12:00:00.000Z',
          stats: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
        }
      }),
      CTX
    )

    expect(msg).toMatchObject({
      id: 'db-abc',
      role: 'assistant',
      assistantId: 'asst-1',
      topicId: 'topic-1',
      createdAt: '2026-04-24T12:00:00.000Z',
      askId: 'user-1',
      modelId: 'google::gemini-3',
      siblingsGroupId: 42,
      status: AssistantMessageStatus.SUCCESS
    })
    expect(msg.model).toMatchObject(GEMINI)
    expect(msg.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 })
  })

  it('treats user messages as success with no model/askId', () => {
    const msg = uiToMessage(
      mk({ id: 'u-1', role: 'user', metadata: { createdAt: '2026-04-24T11:59:00.000Z', status: 'success' } }),
      CTX
    )
    expect(msg.role).toBe('user')
    expect(msg.status).toBe(UserMessageStatus.SUCCESS)
    expect(msg.askId).toBeUndefined()
    expect(msg.model).toBeUndefined()
  })

  it('uses fallbacks for optimistic-append assistant with no metadata', () => {
    const msg = uiToMessage(mk({ id: 'temp-1', role: 'assistant', metadata: {} }), {
      ...CTX,
      modelFallback: GEMINI,
      askIdFallback: 'u-1',
      createdAtFallback: '2026-04-24T12:00:05.000Z'
    })

    expect(msg.model).toMatchObject(GEMINI)
    expect(msg.modelId).toBe('google::gemini-3')
    expect(msg.askId).toBe('u-1')
    expect(msg.createdAt).toBe('2026-04-24T12:00:05.000Z')
    expect(msg.status).toBe(AssistantMessageStatus.PENDING)
  })

  it('maps DB status values', () => {
    expect(uiToMessage(mk({ metadata: { status: 'pending' } }), CTX).status).toBe(AssistantMessageStatus.PENDING)
    expect(uiToMessage(mk({ metadata: { status: 'error' } }), CTX).status).toBe(AssistantMessageStatus.ERROR)
    expect(uiToMessage(mk({ metadata: { status: 'paused' } }), CTX).status).toBe(AssistantMessageStatus.SUCCESS)
    expect(uiToMessage(mk({ metadata: { status: 'success' } }), CTX).status).toBe(AssistantMessageStatus.SUCCESS)
  })

  it('prefers metadata over fallbacks when both present', () => {
    const KIMI: ModelSnapshot = { id: 'kimi', name: 'Kimi', provider: 'moonshot' }
    const msg = uiToMessage(
      mk({
        metadata: {
          modelSnapshot: KIMI,
          modelId: 'moonshot::kimi',
          parentId: 'real-parent',
          createdAt: '2026-04-24T10:00:00.000Z',
          status: 'success'
        }
      }),
      { ...CTX, modelFallback: GEMINI, askIdFallback: 'wrong', createdAtFallback: 'wrong' }
    )

    expect(msg.model).toMatchObject(KIMI)
    expect(msg.modelId).toBe('moonshot::kimi')
    expect(msg.askId).toBe('real-parent')
    expect(msg.createdAt).toBe('2026-04-24T10:00:00.000Z')
  })
})
