import { describe, expect, it } from 'vitest'

import { toGbnfJsonSchema } from '../toolSchema'

// node-llama-cpp compiles any shape it does not recognize to `null`, which forces the model to
// pass null for that argument. Each case is a shape real MCP tool schemas use.
const ANY_VALUE = {
  oneOf: [
    { type: ['string', 'number', 'boolean', 'null'] },
    { type: 'object', additionalProperties: true },
    { type: 'array' }
  ]
}

describe('toGbnfJsonSchema', () => {
  it('turns an optional argument written with anyOf into a oneOf', () => {
    const schema = { type: 'object', properties: { mode: { anyOf: [{ type: 'string' }, { type: 'null' }] } } }

    expect(toGbnfJsonSchema(schema)).toMatchObject({
      properties: { mode: { oneOf: [{ type: 'string' }, { type: 'null' }] } }
    })
  })

  it('accepts any value for an argument with no type', () => {
    const schema = { type: 'object', properties: { value: { description: 'anything' } } }

    expect(toGbnfJsonSchema(schema)).toMatchObject({ properties: { value: { description: 'anything', ...ANY_VALUE } } })
  })

  it('lets an object without declared properties carry arbitrary keys', () => {
    expect(toGbnfJsonSchema({ type: 'object' })).toEqual({ type: 'object', additionalProperties: true })
  })

  it('keeps an object with declared properties closed unless it allows more', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'missing'] }

    expect(toGbnfJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false
    })
  })

  it('splits a type list containing an object into alternatives', () => {
    const schema = { type: ['object', 'null'], properties: { a: { type: 'string' } } }

    expect(toGbnfJsonSchema(schema)).toEqual({
      oneOf: [{ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, { type: 'null' }]
    })
  })

  it('drops string formats the grammar cannot enforce instead of failing the request', () => {
    expect(toGbnfJsonSchema({ type: 'string', format: 'uri' })).toEqual({ type: 'string' })
    expect(toGbnfJsonSchema({ type: 'string', format: 'date' })).toEqual({ type: 'string', format: 'date' })
  })

  it('resolves draft-07 definitions through $defs', () => {
    const schema = {
      type: 'object',
      properties: { a: { $ref: '#/definitions/A' } },
      definitions: { A: { type: 'string' } }
    }

    expect(toGbnfJsonSchema(schema)).toMatchObject({
      $defs: { A: { type: 'string' } },
      properties: { a: { $ref: '#/$defs/A' } }
    })
  })

  it('merges allOf object parts into one object', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { properties: { b: { type: 'number' } } }
      ]
    }

    expect(toGbnfJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
      additionalProperties: false
    })
  })
})
