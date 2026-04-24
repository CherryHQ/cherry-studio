import { describe, expect, it } from 'vitest'

import {
  PromptVariableInputSchema,
  PromptVariableSelectSchema,
  PromptVariablesSchema,
  PromptVersionSchema
} from '../prompt'

describe('PromptVersionSchema', () => {
  const baseVersion = {
    id: '019dbeea-3c00-73cb-acba-ec41b092cffa',
    promptId: '019dbeea-3c01-70e1-b362-63fb55a380f3',
    version: 4,
    content: 'Prompt content',
    variables: null,
    createdAt: new Date(1700000000000).toISOString()
  }

  it('accepts normal edit versions', () => {
    expect(PromptVersionSchema.parse({ ...baseVersion, rollbackFrom: null })).toEqual({
      ...baseVersion,
      rollbackFrom: null
    })
  })

  it('accepts rollback metadata', () => {
    expect(PromptVersionSchema.parse({ ...baseVersion, rollbackFrom: 1 })).toEqual({
      ...baseVersion,
      rollbackFrom: 1
    })
  })

  it('accepts version with variables', () => {
    const vars = [{ id: 'v_1', key: 'lang', type: 'select' as const, options: ['en', 'zh'] }]
    const result = PromptVersionSchema.parse({ ...baseVersion, rollbackFrom: null, variables: vars })
    expect(result.variables).toEqual(vars)
  })
})

describe('PromptVariableInputSchema', () => {
  it('accepts minimal input variable', () => {
    const result = PromptVariableInputSchema.parse({ id: 'v_1', key: 'name', type: 'input' })
    expect(result.key).toBe('name')
    expect(result.type).toBe('input')
  })

  it('accepts input with all optional fields', () => {
    const result = PromptVariableInputSchema.parse({
      id: 'v_2',
      key: 'content',
      type: 'input',
      defaultValue: 'hello',
      placeholder: 'Enter text...'
    })
    expect(result.defaultValue).toBe('hello')
    expect(result.placeholder).toBe('Enter text...')
  })

  it('rejects empty key', () => {
    expect(() => PromptVariableInputSchema.parse({ id: 'v_1', key: '', type: 'input' })).toThrow()
  })

  it('rejects missing id', () => {
    expect(() => PromptVariableInputSchema.parse({ key: 'name', type: 'input' })).toThrow()
  })
})

describe('PromptVariableSelectSchema', () => {
  it('accepts valid select variable', () => {
    const result = PromptVariableSelectSchema.parse({
      id: 'v_1',
      key: 'lang',
      type: 'select',
      options: ['en', 'zh']
    })
    expect(result.options).toEqual(['en', 'zh'])
  })

  it('accepts select with valid defaultValue', () => {
    const result = PromptVariableSelectSchema.parse({
      id: 'v_1',
      key: 'lang',
      type: 'select',
      defaultValue: 'en',
      options: ['en', 'zh']
    })
    expect(result.defaultValue).toBe('en')
  })

  it('rejects defaultValue not in options', () => {
    expect(() =>
      PromptVariableSelectSchema.parse({
        id: 'v_1',
        key: 'lang',
        type: 'select',
        defaultValue: 'fr',
        options: ['en', 'zh']
      })
    ).toThrow('defaultValue must be one of the options')
  })

  it('rejects empty options array', () => {
    expect(() =>
      PromptVariableSelectSchema.parse({
        id: 'v_1',
        key: 'lang',
        type: 'select',
        options: []
      })
    ).toThrow()
  })
})

describe('PromptVariablesSchema', () => {
  it('accepts valid variables array', () => {
    const result = PromptVariablesSchema.parse([
      { id: 'v_1', key: 'name', type: 'input' },
      { id: 'v_2', key: 'lang', type: 'select', options: ['en', 'zh'] }
    ])
    expect(result).toHaveLength(2)
  })

  it('rejects duplicate ids', () => {
    expect(() =>
      PromptVariablesSchema.parse([
        { id: 'v_1', key: 'a', type: 'input' },
        { id: 'v_1', key: 'b', type: 'input' }
      ])
    ).toThrow('Variable ids must be unique')
  })

  it('rejects duplicate keys', () => {
    expect(() =>
      PromptVariablesSchema.parse([
        { id: 'v_1', key: 'name', type: 'input' },
        { id: 'v_2', key: 'name', type: 'input' }
      ])
    ).toThrow('Variable keys must be unique')
  })

  it('accepts empty array', () => {
    const result = PromptVariablesSchema.parse([])
    expect(result).toEqual([])
  })
})
