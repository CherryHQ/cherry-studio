import { describe, expect, it } from 'vitest'

import { PromptContentSchema, PromptSchema, PromptTitleSchema } from '../prompt'

const prompt = {
  id: '019dbeea-3c00-73cb-acba-ec41b092cffa',
  title: 'Greeting',
  content: 'Hello',
  createdAt: new Date(1700000000000).toISOString(),
  updatedAt: new Date(1700000000000).toISOString()
}

describe('PromptSchema', () => {
  it('accepts the unified prompt shape', () => {
    expect(PromptSchema.parse(prompt)).toEqual(prompt)
  })

  it('rejects removed version and variable fields', () => {
    expect(() => PromptSchema.parse({ ...prompt, currentVersion: 1 })).toThrow()
    expect(() => PromptSchema.parse({ ...prompt, variables: [] })).toThrow()
  })

  it('rejects missing title or content', () => {
    expect(() => PromptSchema.parse({ ...prompt, title: undefined })).toThrow()
    expect(() => PromptSchema.parse({ ...prompt, content: undefined })).toThrow()
  })
})

describe('PromptTitleSchema', () => {
  it('accepts non-empty titles', () => {
    expect(PromptTitleSchema.parse('Trip Planner')).toBe('Trip Planner')
  })

  it('rejects empty titles', () => {
    expect(() => PromptTitleSchema.parse('')).toThrow()
  })
})

describe('PromptContentSchema', () => {
  it('accepts non-empty content', () => {
    expect(PromptContentSchema.parse('Plan a trip')).toBe('Plan a trip')
  })

  it('rejects empty content', () => {
    expect(() => PromptContentSchema.parse('')).toThrow()
  })
})
