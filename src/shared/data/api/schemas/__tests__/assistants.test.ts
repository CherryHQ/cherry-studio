import { describe, expect, it } from 'vitest'

import { ImportAssistantSchema, UpdateAssistantSchema } from '../assistants'

describe('ImportAssistantSchema', () => {
  it('accepts and normalizes a v1 group name beyond the current edit limit', () => {
    const longName = 'x'.repeat(65)

    expect(
      ImportAssistantSchema.parse({
        name: 'Imported assistant',
        prompt: 'legacy prompt',
        groupName: `  ${longName}  `,
        regularPhrases: [{ title: ' Greeting ', content: 'Hello' }]
      })
    ).toEqual({
      name: 'Imported assistant',
      prompt: 'legacy prompt',
      groupName: longName,
      regularPhrases: [{ title: 'Greeting', content: 'Hello' }]
    })
  })

  it('rejects malformed legacy phrases', () => {
    expect(
      ImportAssistantSchema.safeParse({
        name: 'Imported assistant',
        prompt: 'legacy prompt',
        regularPhrases: [{ title: 'Empty', content: '' }]
      }).success
    ).toBe(false)
  })

  it('rejects fields that do not exist in the legacy import contract', () => {
    expect(
      ImportAssistantSchema.safeParse({
        name: 'Imported assistant',
        prompt: 'legacy prompt',
        groupId: '11111111-1111-4111-8111-111111111111'
      }).success
    ).toBe(false)
  })

  it('validates persisted service tier selections', () => {
    expect(UpdateAssistantSchema.parse({ settings: { service_tier: 'flex' } }).settings?.service_tier).toBe('flex')
    expect(UpdateAssistantSchema.safeParse({ settings: { service_tier: 'turbo' } }).success).toBe(false)
  })
})
