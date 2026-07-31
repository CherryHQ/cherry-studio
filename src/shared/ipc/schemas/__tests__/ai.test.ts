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

  it('accepts a cancellable text request id and rejects an empty one', () => {
    expect(genText.safeParse({ requestId: 'greeting-1', prompt: 'hi' }).success).toBe(true)
    expect(genText.safeParse({ requestId: '', prompt: 'hi' }).success).toBe(false)
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

describe('ai.stream.open greeting context validation', () => {
  const openStream = aiRequestSchemas['ai.stream.open'].input
  const base = {
    topicId: 'topic-1',
    trigger: 'submit-message' as const,
    userMessageParts: [{ type: 'text', text: 'yes' }]
  }

  it('accepts and trims a bounded plain-text greeting', () => {
    expect(openStream.parse({ ...base, greetingContext: '  Want to play a game?  ' })).toMatchObject({
      greetingContext: 'Want to play a game?'
    })
  })

  it.each([
    ['overlong text', 'x'.repeat(121)],
    ['markup', '**Want to play?**'],
    ['bidirectional override', 'Safe link \u202Emoc.elpmaxe']
  ])('rejects unsafe greeting context at the IPC boundary: %s', (_caseName, greetingContext) => {
    expect(openStream.safeParse({ ...base, greetingContext }).success).toBe(false)
  })
})
