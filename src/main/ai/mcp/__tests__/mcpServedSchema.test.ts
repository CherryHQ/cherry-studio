import { describe, expect, it } from 'vitest'

import { normalizeMcpServedSchema } from '../mcpServedSchema'

describe('normalizeMcpServedSchema', () => {
  it('converts boolean schemas to equivalent object schemas', () => {
    expect(normalizeMcpServedSchema(true)).toEqual({})
    expect(normalizeMcpServedSchema(false)).toEqual({ not: {} })
  })

  it.each(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'])(
    'normalizes schema values in %s without mutating the source',
    (keyword) => {
      const source = {
        [keyword]: { allowed: true, forbidden: false, ['__proto__']: true, nested: { not: false } }
      }
      const original = structuredClone(source)

      expect(normalizeMcpServedSchema(source)).toEqual({
        [keyword]: { allowed: {}, forbidden: { not: {} }, ['__proto__']: {}, nested: { not: { not: {} } } }
      })
      expect(source).toEqual(original)
    }
  )

  it.each([
    'additionalProperties',
    'unevaluatedProperties',
    'propertyNames',
    'items',
    'contains',
    'unevaluatedItems',
    'additionalItems',
    'not',
    'if',
    'then',
    'else'
  ])('normalizes boolean and nested schemas in %s without mutating the source', (keyword) => {
    expect(normalizeMcpServedSchema({ [keyword]: true })).toEqual({ [keyword]: {} })
    expect(normalizeMcpServedSchema({ [keyword]: false })).toEqual({ [keyword]: { not: {} } })
    const source = { [keyword]: { properties: { child: false } } }
    const original = structuredClone(source)

    expect(normalizeMcpServedSchema(source)).toEqual({ [keyword]: { properties: { child: { not: {} } } } })
    expect(source).toEqual(original)
  })

  it.each(['items', 'prefixItems', 'allOf', 'anyOf', 'oneOf'])(
    'normalizes schema arrays in %s without mutating the source',
    (keyword) => {
      const source = { [keyword]: [true, false, { not: true }] }
      const original = structuredClone(source)

      expect(normalizeMcpServedSchema(source)).toEqual({ [keyword]: [{}, { not: {} }, { not: {} }] })
      expect(source).toEqual(original)
    }
  )

  it('leaves boolean literals and schema-shaped data untouched', () => {
    const source = {
      properties: {
        literal: { default: true, const: true, enum: [true, false] },
        properties: { default: { items: true, properties: { child: false } } }
      },
      default: { properties: { child: true } },
      const: false,
      enum: [true, false],
      examples: [{ items: false }],
      required: ['true'],
      extension: { not: true }
    }
    const original = structuredClone(source)

    expect(normalizeMcpServedSchema(source)).toEqual(original)
    expect(source).toEqual(original)
  })

  it.each([{ value: null }, { value: undefined }, { value: 'true' }, { value: 42 }, { value: [true, false] }])(
    'returns non-schema input $value as-is',
    ({ value }) => {
      expect(normalizeMcpServedSchema(value)).toBe(value)
    }
  )
})
