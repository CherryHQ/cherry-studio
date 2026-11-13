import { describe, expect, it } from 'vitest'

import { createMcpInputSchema } from '../../mcpSchema'

describe('createMcpInputSchema', () => {
  it.each([undefined, 'object'] as const)('preserves root references without adding siblings (type=%s)', (type) => {
    const input = {
      ...(type ? { type } : {}),
      $ref: '#/$defs/Input',
      $defs: {
        Input: { type: 'object' as const, properties: { query: { type: 'string' as const } }, required: ['query'] }
      }
    }
    expect(createMcpInputSchema(input).jsonSchema).toEqual(input)
    expect(input).not.toHaveProperty('properties')
  })

  it('fills in an object type and empty properties for parameterless tools', () => {
    const schema = createMcpInputSchema({})

    expect(schema.jsonSchema).toEqual({ type: 'object', properties: {} })
  })

  it('adds properties when an object schema omits them', () => {
    const schema = createMcpInputSchema({ type: 'object' })

    expect(schema.jsonSchema).toEqual({ type: 'object', properties: {} })
  })

  it('keeps existing parameters unchanged', () => {
    const input = { type: 'object' as const, properties: { path: { type: 'string' as const } }, required: ['path'] }
    const schema = createMcpInputSchema(input)

    expect(schema.jsonSchema).toEqual(input)
    expect(input).toEqual({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'] })
  })
})
