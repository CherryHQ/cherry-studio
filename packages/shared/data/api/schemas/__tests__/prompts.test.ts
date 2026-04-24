import { describe, expect, it } from 'vitest'

import { CreatePromptSchema, UpdatePromptSchema } from '../prompts'

describe('prompt DTO schemas', () => {
  it('rejects empty update payloads', () => {
    expect(() => UpdatePromptSchema.parse({})).toThrow('At least one field is required')
  })

  it('accepts title-only updates', () => {
    const result = UpdatePromptSchema.parse({ title: 'renamed' })
    expect(result.title).toBe('renamed')
  })

  it('accepts variables-only updates', () => {
    const result = UpdatePromptSchema.parse({
      variables: [{ id: 'v_1', key: 'lang', type: 'select', options: ['en', 'zh'] }]
    })
    expect(result.variables).toHaveLength(1)
  })

  it('rejects null variables (optional, not nullable at the boundary)', () => {
    expect(() => UpdatePromptSchema.parse({ variables: null })).toThrow()
  })

  it('rejects unknown fields (Rule C strictObject defense)', () => {
    expect(() => UpdatePromptSchema.parse({ title: 'x', sortOrder: 3 })).toThrow()
  })

  it('accepts create with variables', () => {
    const result = CreatePromptSchema.parse({
      title: 'Test',
      content: 'Hello ${name}',
      variables: [{ id: 'v_1', key: 'name', type: 'input', placeholder: 'Your name' }]
    })
    expect(result.variables).toHaveLength(1)
    expect(result.variables![0].key).toBe('name')
  })

  it('rejects create with null variables', () => {
    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        variables: null
      })
    ).toThrow()
  })

  it('accepts create without variables field', () => {
    const result = CreatePromptSchema.parse({
      title: 'Test',
      content: 'Hello'
    })
    expect(result.variables).toBeUndefined()
  })
})
