import { describe, expect, it } from 'vitest'

import { type JsonSchemaLike, jsonSchemaToZod } from '../converters/jsonSchemaToZod'

describe('jsonSchemaToZod', () => {
  it('maps string with min/max constraints', () => {
    const schema = jsonSchemaToZod({ type: 'string', minLength: 2, maxLength: 4 })
    expect(schema.safeParse('abc').success).toBe(true)
    expect(schema.safeParse('a').success).toBe(false)
    expect(schema.safeParse('abcde').success).toBe(false)
  })

  it('drops an invalid client-supplied regex pattern instead of throwing', () => {
    // An unbalanced group is an invalid RegExp — must be swallowed, not surfaced as a 500.
    const schema = jsonSchemaToZod({ type: 'string', pattern: '(' })
    expect(schema.safeParse('anything').success).toBe(true)
  })

  it('applies a valid regex pattern', () => {
    const schema = jsonSchemaToZod({ type: 'string', pattern: '^a+$' })
    expect(schema.safeParse('aaa').success).toBe(true)
    expect(schema.safeParse('b').success).toBe(false)
  })

  it('maps integer with min/max and rejects non-integers', () => {
    const schema = jsonSchemaToZod({ type: 'integer', minimum: 0, maximum: 10 })
    expect(schema.safeParse(5).success).toBe(true)
    expect(schema.safeParse(-1).success).toBe(false)
    expect(schema.safeParse(2.5).success).toBe(false)
  })

  it('maps boolean and null', () => {
    expect(jsonSchemaToZod({ type: 'boolean' }).safeParse(true).success).toBe(true)
    expect(jsonSchemaToZod({ type: 'boolean' }).safeParse('x').success).toBe(false)
    expect(jsonSchemaToZod({ type: 'null' }).safeParse(null).success).toBe(true)
    expect(jsonSchemaToZod({ type: 'null' }).safeParse(0).success).toBe(false)
  })

  it('maps a string enum (accepts members, rejects others)', () => {
    const schema = jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] })
    expect(schema.safeParse('a').success).toBe(true)
    expect(schema.safeParse('c').success).toBe(false)
  })

  it('maps a union type array (["string", "null"])', () => {
    const schema = jsonSchemaToZod({ type: ['string', 'null'] } as JsonSchemaLike)
    expect(schema.safeParse('x').success).toBe(true)
    expect(schema.safeParse(null).success).toBe(true)
    expect(schema.safeParse(42).success).toBe(false)
  })

  it('maps array with item schema and min/max items', () => {
    const schema = jsonSchemaToZod({ type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 2 })
    expect(schema.safeParse([1]).success).toBe(true)
    expect(schema.safeParse([]).success).toBe(false)
    expect(schema.safeParse([1, 2, 3]).success).toBe(false)
    expect(schema.safeParse(['x']).success).toBe(false)
  })

  it('maps object with required + optional properties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name']
    })
    expect(schema.safeParse({ name: 'a' }).success).toBe(true) // age optional
    expect(schema.safeParse({ name: 'a', age: 3 }).success).toBe(true)
    expect(schema.safeParse({ age: 3 }).success).toBe(false) // name required
  })

  it('maps a boolean `true` property schema to "accept anything"', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { open: true } as unknown as JsonSchemaLike['properties'],
      required: ['open']
    })
    expect(schema.safeParse({ open: 123 }).success).toBe(true)
    expect(schema.safeParse({ open: { nested: 'ok' } }).success).toBe(true)
  })

  it('maps a boolean `false` property schema to "reject any provided value" (z.never)', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { closed: false } as unknown as JsonSchemaLike['properties']
    })
    expect(schema.safeParse({ closed: 'x' }).success).toBe(false)
  })

  it('honors `required` for boolean property schemas (non-required → optional)', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { maybe: true } as unknown as JsonSchemaLike['properties'],
      required: []
    })
    // `maybe` accepts anything but is not required, so it may be omitted.
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ maybe: 1 }).success).toBe(true)
  })

  it('falls back to unknown for an unspecified type', () => {
    const schema = jsonSchemaToZod({} as JsonSchemaLike)
    expect(schema.safeParse({ anything: true }).success).toBe(true)
  })

  it('preserves the schema description', () => {
    const schema = jsonSchemaToZod({ type: 'string', description: 'a name' })
    expect(schema.description).toBe('a name')
  })
})
