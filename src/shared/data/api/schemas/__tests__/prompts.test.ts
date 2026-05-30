import { describe, expect, it } from 'vitest'

import { PROMPT_CONTENT_MAX, PROMPT_TITLE_MAX } from '../../../types/prompt'
import { CreatePromptSchema, ListPromptsQuerySchema, UpdatePromptSchema } from '../prompts'

describe('prompt DTO schemas', () => {
  it('accepts create with title and content', () => {
    const result = CreatePromptSchema.parse({
      title: 'Test',
      content: 'Hello'
    })

    expect(result).toEqual({ title: 'Test', content: 'Hello' })
  })

  it('rejects create with empty title or content', () => {
    expect(() => CreatePromptSchema.parse({ title: '', content: 'Hello' })).toThrow()
    expect(() => CreatePromptSchema.parse({ title: 'Test', content: '' })).toThrow()
  })

  it('rejects create values over schema limits', () => {
    expect(() => CreatePromptSchema.parse({ title: 'x'.repeat(PROMPT_TITLE_MAX + 1), content: 'Hello' })).toThrow()
    expect(() => CreatePromptSchema.parse({ title: 'Test', content: 'x'.repeat(PROMPT_CONTENT_MAX + 1) })).toThrow()
  })

  it('rejects create with unknown prompt fields', () => {
    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        scope: 'global'
      })
    ).toThrow()

    expect(() =>
      CreatePromptSchema.parse({
        title: 'Test',
        content: 'Hello',
        variables: []
      })
    ).toThrow()
  })

  it('rejects empty update payloads', () => {
    expect(() => UpdatePromptSchema.parse({})).toThrow('At least one field is required')
  })

  it('accepts partial title/content updates', () => {
    expect(UpdatePromptSchema.parse({ title: 'renamed' })).toEqual({ title: 'renamed' })
    expect(UpdatePromptSchema.parse({ content: 'updated' })).toEqual({ content: 'updated' })
  })

  it('rejects update with empty title or content', () => {
    expect(() => UpdatePromptSchema.parse({ title: '' })).toThrow()
    expect(() => UpdatePromptSchema.parse({ content: '' })).toThrow()
  })

  it('rejects removed version, scope, and variable fields', () => {
    expect(() => UpdatePromptSchema.parse({ currentVersion: 2 })).toThrow()
    expect(() => UpdatePromptSchema.parse({ assistantId: 'assistant-1' })).toThrow()
    expect(() => UpdatePromptSchema.parse({ variables: [] })).toThrow()
  })

  it('accepts and trims list search query', () => {
    expect(ListPromptsQuerySchema.parse({ search: ' daily ' })).toEqual({ search: 'daily' })
  })

  it('rejects empty list search query and unknown query fields', () => {
    expect(() => ListPromptsQuerySchema.parse({ search: '   ' })).toThrow()
    expect(() => ListPromptsQuerySchema.parse({ tagIds: ['tag-1'] })).toThrow()
  })
})
