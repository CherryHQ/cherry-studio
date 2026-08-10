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

describe('ai.agent.feedback_session.create IPC schema', () => {
  const createFeedbackSession = aiRequestSchemas['ai.agent.feedback_session.create'].input
  const createFeedbackSessionResult = aiRequestSchemas['ai.agent.feedback_session.create'].output

  it('accepts only a void command payload', () => {
    expect(createFeedbackSession.safeParse(undefined).success).toBe(true)
    expect(createFeedbackSession.safeParse({}).success).toBe(false)
  })

  it('returns only the created session id', () => {
    expect(createFeedbackSessionResult.parse({ sessionId: 'feedback-session' })).toEqual({
      sessionId: 'feedback-session'
    })
    expect(
      createFeedbackSessionResult.safeParse({ sessionId: 'feedback-session', agentId: 'cherry-assistant' }).success
    ).toBe(false)
  })
})
