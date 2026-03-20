import { describe, expect, it } from 'vitest'

import { ReorderPromptsDtoSchema, UpdatePromptDtoSchema } from '../prompts'

describe('prompt DTO schemas', () => {
  it('rejects empty update payloads', () => {
    expect(() => UpdatePromptDtoSchema.parse({})).toThrow('At least one field is required')
  })

  it('requires at least one reorder item', () => {
    expect(() => ReorderPromptsDtoSchema.parse({ items: [] })).toThrow()
  })

  it('validates reorder item ids as UUIDs', () => {
    expect(() =>
      ReorderPromptsDtoSchema.parse({
        items: [{ id: 'not-a-uuid', sortOrder: 0 }]
      })
    ).toThrow()
  })
})
