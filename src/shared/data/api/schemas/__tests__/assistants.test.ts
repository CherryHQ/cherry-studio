import { describe, expect, it } from 'vitest'

import { DEFAULT_ASSISTANT_SETTINGS } from '../../../types/assistant'
import { CreateAssistantSchema, ImportAssistantSchema } from '../assistants'

describe('CreateAssistantSchema', () => {
  it('accepts a duplicate payload whose legacy settings predate runtime context', () => {
    const legacySettings = { ...DEFAULT_ASSISTANT_SETTINGS }
    delete legacySettings.enableRuntimeContext

    const duplicate = CreateAssistantSchema.parse({
      name: 'Legacy assistant (copy)',
      settings: legacySettings
    })

    expect(duplicate.settings?.enableRuntimeContext).toBeUndefined()
  })
})

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
