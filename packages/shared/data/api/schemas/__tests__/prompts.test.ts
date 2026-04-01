import { describe, expect, it } from 'vitest'

import { CreatePromptDtoSchema, UpdatePromptDtoSchema } from '../prompts'

describe('prompt DTO schemas', () => {
  it('rejects empty update payloads', () => {
    expect(() => UpdatePromptDtoSchema.parse({})).toThrow('At least one field is required')
  })

  it('accepts sortOrder-only updates', () => {
    const result = UpdatePromptDtoSchema.parse({ sortOrder: 3 })
    expect(result.sortOrder).toBe(3)
  })

  it('accepts variables-only updates', () => {
    const result = UpdatePromptDtoSchema.parse({
      variables: [{ id: 'v_1', key: 'lang', type: 'select', options: ['en', 'zh'] }]
    })
    expect(result.variables).toHaveLength(1)
  })

  it('accepts create with variables', () => {
    const result = CreatePromptDtoSchema.parse({
      title: 'Test',
      content: 'Hello ${name}',
      variables: [{ id: 'v_1', key: 'name', type: 'input', placeholder: 'Your name' }]
    })
    expect(result.variables).toHaveLength(1)
    expect(result.variables![0].key).toBe('name')
  })

  it('accepts create with null variables', () => {
    const result = CreatePromptDtoSchema.parse({
      title: 'Test',
      content: 'Hello',
      variables: null
    })
    expect(result.variables).toBeNull()
  })

  it('accepts create without variables field', () => {
    const result = CreatePromptDtoSchema.parse({
      title: 'Test',
      content: 'Hello'
    })
    expect(result.variables).toBeUndefined()
  })
})
