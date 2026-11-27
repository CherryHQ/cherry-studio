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

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'object'],
    ['boolean', true],
    ['array', []],
    ['non-object type', { type: 'string', minLength: 1 }],
    ['non-object type array', { type: ['string', 'number'] }]
  ])('normalizes %s root schema to a valid object schema for local validation and wire use', (_label, input) => {
    const schema = createMcpInputSchema(input as never)

    expect(schema.jsonSchema).toEqual({ type: 'object', properties: {} })
    expect(schema.validate!({})).toMatchObject({ success: true })
  })

  it('normalizes nullable object and root combinator MCP schemas to type object', () => {
    const nullable = createMcpInputSchema({
      type: ['object', 'null'] as never,
      properties: { query: { type: 'string' } }
    })
    expect(nullable.jsonSchema).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } }
    })

    const union = createMcpInputSchema({
      anyOf: [
        { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] }
      ]
    } as never)
    expect(union.jsonSchema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' }, slug: { type: 'string' } }
    })
    expect(union.validate!({ id: 'abc' })).toMatchObject({ success: true })
    expect(union.validate!({ other: 1 })).toMatchObject({ success: false })
  })
})
