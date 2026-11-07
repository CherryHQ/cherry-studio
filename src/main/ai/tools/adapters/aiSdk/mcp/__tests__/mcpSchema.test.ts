import { describe, expect, it } from 'vitest'

import { createMcpInputSchema } from '../../mcpSchema'

describe('createMcpInputSchema', () => {
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
