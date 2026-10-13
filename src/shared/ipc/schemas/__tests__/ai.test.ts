import { describe, expect, it } from 'vitest'

import type { AiStreamOpenRequest } from '@shared/ai/transport'

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

  it('preserves reserved-branch target intent at the renderer-to-main boundary', () => {
    expect(
      openStream.parse({
        trigger: 'submit-message',
        topicId: 'topic-1',
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
        topicId: 'topic-1',
        userMessageParts: [],
        targetMode: 'current-stream'
      }).success
    ).toBe(false)
  })

  it('accepts an explicit failed assistant row for in-place retry', () => {
    expect(
      openStream.parse({
        trigger: 'regenerate-message',
        topicId: 'topic-1',
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
        topicId: 'topic-1',
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
        topicId: 'topic-1',
        userMessageParts: [],
        mentionedModelIds: ['openai::gpt-4o', 'openai::gpt-4o']
      }).success
    ).toBe(false)
  })

  it('rejects combining in-place retry with live reply-group append', () => {
    const combined = {
      trigger: 'regenerate-message',
      topicId: 'topic-1',
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

describe('ai.agent.session.fork IPC schema', () => {
  it('accepts only the source session and checkpoint message, rejecting history reconstruction', () => {
    const forkSession = aiRequestSchemas['ai.agent.session.fork'].input
    const input = {
      sourceSessionId: '11111111-1111-4111-8111-111111111111',
      messageId: '22222222-2222-4222-8222-222222222222'
    }

    expect(forkSession.parse(input)).toEqual(input)
    expect(forkSession.safeParse({ ...input, allowHistoryRebuild: true }).success).toBe(false)
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

describe('ai.agent.session.restore IPC schema', () => {
  const restoreSession = aiRequestSchemas['ai.agent.session.restore'].input

  it('requires exactly one non-empty Session id', () => {
    expect(restoreSession.safeParse({ sessionId: 'session-1' }).success).toBe(true)
    expect(restoreSession.safeParse({ sessionId: '' }).success).toBe(false)
    expect(restoreSession.safeParse({ sessionId: 'session-1', extra: true }).success).toBe(false)
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

describe('ai.agent.skill_session.create IPC schema', () => {
  const createSkillSession = aiRequestSchemas['ai.agent.skill_session.create'].input
  const createSkillSessionResult = aiRequestSchemas['ai.agent.skill_session.create'].output

  it('requires one non-empty Skill id and rejects unrelated fields', () => {
    expect(createSkillSession.parse({ skillId: 'skill-1' })).toEqual({ skillId: 'skill-1' })
    expect(createSkillSession.safeParse({ skillId: '' }).success).toBe(false)
    expect(createSkillSession.safeParse({ skillId: 'skill-1', agentId: 'agent-1' }).success).toBe(false)
  })

  it('returns only the prepared Session id', () => {
    expect(createSkillSessionResult.parse({ sessionId: 'session-1' })).toEqual({ sessionId: 'session-1' })
    expect(createSkillSessionResult.safeParse({ sessionId: 'session-1', skillId: 'skill-1' }).success).toBe(false)
  })
})
