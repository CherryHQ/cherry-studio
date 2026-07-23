import { describe, expect, it } from 'vitest'

import { ImportAssistantSchema } from '../assistants'

describe('ImportAssistantSchema', () => {
  it('accepts and normalizes a v1 group name beyond the current edit limit', () => {
    const longName = 'x'.repeat(65)

    expect(
      ImportAssistantSchema.parse({
        name: 'Imported assistant',
        prompt: 'legacy prompt',
        groupName: `  ${longName}  `
      })
    ).toEqual({
      name: 'Imported assistant',
      prompt: 'legacy prompt',
      groupName: longName
    })
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
})
