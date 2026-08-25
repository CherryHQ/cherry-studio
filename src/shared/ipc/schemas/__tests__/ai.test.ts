import { ConversationInputTarget, ConversationKind } from '@shared/ai/conversation'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { describe, expect, it } from 'vitest'

import { aiRequestSchemas } from '../ai'

// The AI IPC boundary validates `uniqueModelId` with the strict `UniqueModelIdSchema`
// (`providerId::modelId`, separator at a real position, both parts well-formed), so a
// malformed id is rejected here instead of penetrating to `parseUniqueModelId` and
// throwing deeper in the routing code.
describe('ai IPC schemas — uniqueModelId validation', () => {
  const genText = aiRequestSchemas['ai.text.generate'].input
  const genImage = aiRequestSchemas['ai.image.generate'].input

  it('accepts a well-formed providerId::modelId (shared aiBaseRequestShape)', () => {
    expect(genText.safeParse({ uniqueModelId: 'openai::gpt-4o', prompt: 'hi' }).success).toBe(true)
  })

  it('rejects a malformed uniqueModelId (missing/leading separator, empty part, non-string)', () => {
    for (const uniqueModelId of ['no-separator', '::gpt-4o', 'openai::', 42]) {
      expect(genText.safeParse({ uniqueModelId, prompt: 'hi' }).success).toBe(false)
    }
  })

  it('still allows uniqueModelId to be omitted (optional)', () => {
    expect(genText.safeParse({ prompt: 'hi' }).success).toBe(true)
  })

  it('validates the nested payload uniqueModelId for ai.image.generate', () => {
    const input = (uniqueModelId: string) => ({
      requestId: 'r1',
      payload: { uniqueModelId, prompt: 'a fox', paramValues: {}, cleanupPolicy: 'delete_when_unreferenced' }
    })
    expect(genImage.safeParse(input('openai::gpt-image')).success).toBe(true)
    expect(genImage.safeParse(input('bad-id')).success).toBe(false)
  })
})

describe('ai.stream.open IPC schema', () => {
  const openStream = aiRequestSchemas['ai.stream.open'].input
  const conversation = { kind: ConversationKind.Chat, id: 'topic-1' } as const

  it('preserves reserved-branch target intent at the renderer-to-main boundary', () => {
    expect(
      openStream.parse({
        trigger: 'submit-message',
        conversation,
        parentAnchorId: 'reserved-user',
        userMessageParts: [{ type: 'text', text: 'continue branch' }],
        targetMode: 'reserved-branch'
      })
    ).toMatchObject({ targetMode: 'reserved-branch' })
  })

  it('rejects an unknown target mode', () => {
    expect(
      openStream.safeParse({
        trigger: 'submit-message',
        conversation,
        userMessageParts: [],
        targetMode: 'current-stream'
      }).success
    ).toBe(false)
  })

  it('accepts an explicit failed assistant row for in-place retry', () => {
    expect(
      openStream.parse({
        trigger: 'regenerate-message',
        conversation,
        parentAnchorId: 'user-1',
        retryMessageId: 'assistant-failed',
        mentionedModelIds: ['openai::gpt-4o']
      })
    ).toMatchObject({ retryMessageId: 'assistant-failed' })
  })

  it('preserves an explicit live reply-group append target', () => {
    expect(
      openStream.parse({
        trigger: 'regenerate-message',
        conversation,
        parentAnchorId: 'user-1',
        appendToLiveGroupMessageId: 'assistant-source',
        mentionedModelIds: ['anthropic::claude-sonnet']
      })
    ).toMatchObject({ appendToLiveGroupMessageId: 'assistant-source' })
  })

  it('rejects duplicate mentioned model ids before dispatch', () => {
    expect(
      openStream.safeParse({
        trigger: 'submit-message',
        conversation,
        userMessageParts: [],
        mentionedModelIds: ['openai::gpt-4o', 'openai::gpt-4o']
      }).success
    ).toBe(false)
  })

  it('requires a complete presentation for an Actor-owned NextTurn input', () => {
    const base = {
      trigger: 'submit-message',
      conversation,
      userMessageParts: [{ type: 'text', text: 'queued' }],
      inputTarget: ConversationInputTarget.NextTurn
    }
    expect(openStream.safeParse(base).success).toBe(false)
    expect(
      openStream.safeParse({
        ...base,
        inboxPresentation: {
          draft: { text: 'queued', tokens: [] },
          payload: { text: 'queued', userMessageParts: base.userMessageParts }
        }
      }).success
    ).toBe(true)
  })

  it('rejects presentation state on direct and NextStep submits', () => {
    const inboxPresentation = {
      draft: { text: 'steer', tokens: [] },
      payload: { text: 'steer', userMessageParts: [{ type: 'text', text: 'steer' }] }
    }
    for (const inputTarget of [undefined, ConversationInputTarget.NextStep]) {
      expect(
        openStream.safeParse({
          trigger: 'submit-message',
          conversation,
          userMessageParts: [{ type: 'text', text: 'steer' }],
          inputTarget,
          inboxPresentation
        }).success
      ).toBe(false)
    }
  })

  it('rejects combining in-place retry with live reply-group append', () => {
    const combined = {
      trigger: 'regenerate-message',
      conversation,
      parentAnchorId: 'user-1',
      retryMessageId: 'assistant-failed',
      appendToLiveGroupMessageId: 'assistant-source'
    } as const

    // @ts-expect-error retry and append are mutually exclusive in the shared request contract
    const invalidRequest: AiStreamOpenRequest = combined

    expect(openStream.safeParse(invalidRequest).success).toBe(false)
  })
})

describe('ai.agent.create IPC schema', () => {
  const createAgent = aiRequestSchemas['ai.agent.create'].input
  const base = {
    type: 'claude-code',
    name: 'Agent',
    model: 'openai::gpt-4'
  }

  it('rejects fields outside the create command contract', () => {
    expect(createAgent.safeParse({ ...base, tagIds: [] }).success).toBe(false)
  })

  it('deduplicates create-only sets at the IPC boundary', () => {
    expect(
      createAgent.parse({
        ...base,
        disabledTools: ['Bash', 'Read', 'Bash'],
        skillIds: ['skill-a', 'skill-b', 'skill-a'],
        knowledgeBaseIds: ['kb-a', 'kb-b', 'kb-a']
      })
    ).toMatchObject({
      disabledTools: ['Bash', 'Read'],
      skillIds: ['skill-a', 'skill-b'],
      knowledgeBaseIds: ['kb-a', 'kb-b']
    })
  })
})

describe('ai.agent.session.delete IPC schema', () => {
  const deleteSessions = aiRequestSchemas['ai.agent.session.delete'].input

  it('bounds one deletion command to the supported SQLite batch size', () => {
    expect(
      deleteSessions.safeParse({ sessionIds: Array.from({ length: 200 }, (_, i) => `session-${i}`) }).success
    ).toBe(true)
    expect(
      deleteSessions.safeParse({ sessionIds: Array.from({ length: 201 }, (_, i) => `session-${i}`) }).success
    ).toBe(false)
  })
})

describe('ai.agent.support_session.create IPC schema', () => {
  const createSupportSession = aiRequestSchemas['ai.agent.support_session.create'].input
  const createSupportSessionResult = aiRequestSchemas['ai.agent.support_session.create'].output

  it('accepts only a void command payload', () => {
    expect(createSupportSession.safeParse(undefined).success).toBe(true)
    expect(createSupportSession.safeParse({}).success).toBe(false)
  })

  it('returns only the created session id', () => {
    expect(createSupportSessionResult.parse({ sessionId: 'feedback-session' })).toEqual({
      sessionId: 'feedback-session'
    })
    expect(
      createSupportSessionResult.safeParse({ sessionId: 'feedback-session', agentId: 'cherry-support' }).success
    ).toBe(false)
  })
})
