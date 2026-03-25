import { describe, expect, it } from 'vitest'

import { UpdatePromptDtoSchema } from '../prompts'

describe('prompt DTO schemas', () => {
  it('rejects empty update payloads', () => {
    expect(() => UpdatePromptDtoSchema.parse({})).toThrow('At least one field is required')
  })

  it('accepts sortOrder-only updates', () => {
    const result = UpdatePromptDtoSchema.parse({ sortOrder: 3 })
    expect(result.sortOrder).toBe(3)
  })
})
