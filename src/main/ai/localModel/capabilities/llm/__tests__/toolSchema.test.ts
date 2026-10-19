import { describe, expect, it } from 'vitest'

// Not exported by the package; it is the check LlamaChat runs on the arguments the model generates.
import { validateObjectAgainstGbnfSchema } from '../../../../../../../node_modules/node-llama-cpp/dist/utils/gbnfJson/utils/validateObjectAgainstGbnfSchema.js'
import { toGbnfJsonSchema, toToolArguments } from '../toolSchema'

// node-llama-cpp compiles any shape it does not recognize to `null`, which forces the model to
// pass null for that argument. Each case is a shape real MCP tool schemas use.
const ANY_VALUE = {
  oneOf: [
    { type: ['string', 'number', 'boolean', 'null'] },
    { type: 'object', additionalProperties: true },
    { type: 'array' }
  ]
}

/** Whether the grammar built from `schema` lets the model produce `value`. */
function generates(schema: unknown, value: unknown): boolean {
  try {
    return validateObjectAgainstGbnfSchema(value, toGbnfJsonSchema(schema))
  } catch {
    return false
  }
}

// The shape of the built-in `session_read` tool: one required id, and options that are only
// valid in some combinations, so the model must be able to leave them out.
const SESSION_READ = {
  type: 'object',
  properties: {
    session_id: { type: 'string', minLength: 1 },
    cursor: { type: 'string' },
    limit: { type: 'integer', exclusiveMinimum: 0 },
    node_id: { type: 'string' },
    include_siblings: { type: 'boolean' },
    message_id: { type: 'string', minLength: 1 },
    tool_call_id: { type: 'string', minLength: 1 }
  },
  required: ['session_id'],
  additionalProperties: false
}

describe('toGbnfJsonSchema', () => {
  it('lets the model leave optional arguments unset and hands the tool only the ones it set', () => {
    const generated = {
      session_id: 'topic-1',
      cursor: null,
      limit: null,
      node_id: null,
      include_siblings: null,
      message_id: 'message-1',
      tool_call_id: null
    }

    expect(generates(SESSION_READ, generated)).toBe(true)
    expect(toToolArguments(SESSION_READ, generated)).toEqual({ session_id: 'topic-1', message_id: 'message-1' })
  })

  it('still makes the model fill a required argument', () => {
    expect(generates(SESSION_READ, { session_id: null, message_id: 'message-1' })).toBe(false)
  })

  it('keeps a null the tool accepts as a value of its own', () => {
    const schema = { type: 'object', properties: { mode: { type: ['string', 'null'] } } }

    expect(toToolArguments(schema, { mode: null })).toEqual({ mode: null })
  })

  it('removes unset optional arguments inside nested objects and arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, note: { type: 'string' } }, required: ['id'] }
        }
      },
      required: ['items']
    }

    expect(toToolArguments(schema, { items: [{ id: 'a', note: null }] })).toEqual({ items: [{ id: 'a' }] })
  })

  it('removes unset optional arguments of an object inside a union', () => {
    const schema = {
      type: 'object',
      properties: {
        target: {
          anyOf: [
            { type: 'object', properties: { id: { type: 'string' }, limit: { type: 'integer' } }, required: ['id'] },
            { type: 'string' }
          ]
        }
      },
      required: ['target']
    }
    const generated = { target: { id: 'x', limit: null } }

    expect(generates(schema, generated)).toBe(true)
    expect(toToolArguments(schema, generated)).toEqual({ target: { id: 'x' } })
  })

  it('decides what a null means from the union branch the arguments came from', () => {
    const schema = {
      type: 'object',
      properties: {
        query: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'list' }, limit: { type: 'integer' } }, required: ['kind'] },
            {
              type: 'object',
              properties: { kind: { const: 'set' }, limit: { type: ['integer', 'null'] } },
              required: ['kind', 'limit']
            }
          ]
        }
      },
      required: ['query']
    }

    expect(generates(schema, { query: { kind: 'list', limit: null } })).toBe(true)
    expect(toToolArguments(schema, { query: { kind: 'list', limit: null } })).toEqual({ query: { kind: 'list' } })
    expect(toToolArguments(schema, { query: { kind: 'set', limit: null } })).toEqual({
      query: { kind: 'set', limit: null }
    })
  })

  it('picks the union branch whose constraints the arguments meet, not just their types', () => {
    const schema = {
      type: 'object',
      properties: {
        filter: {
          oneOf: [
            {
              type: 'object',
              properties: { key: { type: 'string', maxLength: 1 }, limit: { type: 'integer' } },
              required: ['key']
            },
            {
              type: 'object',
              properties: { key: { type: 'string', minLength: 2 }, limit: { type: ['integer', 'null'] } },
              required: ['key', 'limit']
            }
          ]
        }
      },
      required: ['filter']
    }
    const generated = { filter: { key: 'abc', limit: null } }

    expect(generates(schema, generated)).toBe(true)
    expect(toToolArguments(schema, generated)).toEqual(generated)
  })

  it('picks the union branch whose every declared argument the arguments carry', () => {
    const schema = {
      type: 'object',
      properties: {
        filter: {
          oneOf: [
            {
              type: 'object',
              properties: { id: { type: 'string' }, limit: { type: 'integer' }, extra: { type: 'string' } },
              required: ['id']
            },
            {
              type: 'object',
              properties: { id: { type: 'string' }, limit: { type: ['integer', 'null'] } },
              required: ['id', 'limit']
            }
          ]
        }
      },
      required: ['filter']
    }
    const generated = { filter: { id: 'x', limit: null } }

    expect(generates(schema, generated)).toBe(true)
    expect(toToolArguments(schema, generated)).toEqual(generated)
  })

  it('keeps the arguments a union shares with its siblings required in every alternative', () => {
    const schema = {
      type: 'object',
      properties: { workspace_id: { type: 'string' } },
      required: ['workspace_id'],
      oneOf: [
        { properties: { path: { type: 'string' } }, required: ['path'] },
        { properties: { query: { type: 'string' } }, required: ['query'] }
      ]
    }

    expect(generates(schema, { workspace_id: 'w-1', path: '/file' })).toBe(true)
    expect(generates(schema, { path: '/file' })).toBe(false)
    expect(toToolArguments(schema, { workspace_id: 'w-1', path: '/file' })).toEqual({
      workspace_id: 'w-1',
      path: '/file'
    })
  })

  it('removes unset optional arguments inside tuple elements', () => {
    const schema = {
      type: 'object',
      properties: {
        pair: {
          type: 'array',
          prefixItems: [
            { type: 'object', properties: { id: { type: 'string' }, limit: { type: 'integer' } }, required: ['id'] },
            { type: 'string' }
          ]
        }
      },
      required: ['pair']
    }
    const generated = { pair: [{ id: 'x', limit: null }, 'y'] }

    expect(generates(schema, generated)).toBe(true)
    expect(toToolArguments(schema, generated)).toEqual({ pair: [{ id: 'x' }, 'y'] })
  })

  it('keeps an explicit null that an allOf property accepts', () => {
    const schema = { type: 'object', properties: { limit: { allOf: [{ type: ['integer', 'null'] }] } } }

    expect(generates(schema, { limit: null })).toBe(true)
    expect(toToolArguments(schema, { limit: null })).toEqual({ limit: null })
  })

  it('removes unset optional arguments inside the values of a dictionary', () => {
    const schema = {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { id: { type: 'string' }, limit: { type: 'integer' } },
        required: ['id']
      }
    }
    const generated = { first: { id: 'x', limit: null } }

    expect(generates(schema, generated)).toBe(true)
    expect(toToolArguments(schema, generated)).toEqual({ first: { id: 'x' } })
  })

  it('removes unset optional arguments throughout a recursive schema', () => {
    const schema = {
      $ref: '#/$defs/Node',
      $defs: {
        Node: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            note: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/$defs/Node' } }
          },
          required: ['name', 'children']
        }
      }
    }
    const generated = { name: 'root', note: null, children: [{ name: 'leaf', note: null, children: [] }] }

    expect(toToolArguments(schema, generated)).toEqual({ name: 'root', children: [{ name: 'leaf', children: [] }] })
  })

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
    const schema = { type: ['object', 'null'], properties: { a: { type: 'string' } }, required: ['a'] }

    expect(toGbnfJsonSchema(schema)).toEqual({
      oneOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false },
        { type: 'null' }
      ]
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
      required: ['a'],
      definitions: { A: { type: 'string' } }
    }

    expect(toGbnfJsonSchema(schema)).toMatchObject({
      $defs: { A: { type: 'string' } },
      properties: { a: { $ref: '#/$defs/A' } }
    })
    expect(generates(schema, { a: 'x' })).toBe(true)
  })

  it('merges allOf object parts into one object', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { properties: { b: { type: 'number' } }, required: ['b'] }
      ]
    }

    expect(toGbnfJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false
    })
  })

  it('keeps the fields of every referenced allOf part', () => {
    const schema = {
      allOf: [{ $ref: '#/$defs/A' }, { $ref: '#/$defs/B' }],
      $defs: {
        A: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        B: { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] }
      }
    }

    expect(generates(schema, { a: 'a', b: 'b' })).toBe(true)
    expect(generates(schema, { b: 'b' })).toBe(false)
  })

  it('keeps the constraints of every allOf part that declares the same property', () => {
    const schema = {
      allOf: [
        {
          type: 'object',
          properties: { filter: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
          required: ['filter']
        },
        {
          type: 'object',
          properties: { filter: { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] } },
          required: ['filter']
        }
      ]
    }

    expect(generates(schema, { filter: { id: 'row-1', limit: 1 } })).toBe(true)
    expect(generates(schema, { filter: { limit: 1 } })).toBe(false)
    expect(toToolArguments(schema, { filter: { id: 'row-1', limit: 1 } })).toEqual({
      filter: { id: 'row-1', limit: 1 }
    })
  })

  it('keeps the item constraints of every allOf part that declares the same array', () => {
    const rows = (item: unknown) => ({
      type: 'object',
      properties: { rows: { type: 'array', minItems: 1, items: item } },
      required: ['rows']
    })
    const schema = {
      allOf: [
        rows({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }),
        rows({ type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] })
      ]
    }

    expect(generates(schema, { rows: [{ id: 'row-1', limit: 1 }] })).toBe(true)
    expect(generates(schema, { rows: [{ limit: 1 }] })).toBe(false)
    expect(toToolArguments(schema, { rows: [{ id: 'row-1', limit: 1 }] })).toEqual({
      rows: [{ id: 'row-1', limit: 1 }]
    })
  })

  it('requires an alternative of every union an allOf combines', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        limit: { type: 'integer' },
        cursor: { type: 'string' }
      },
      allOf: [
        { anyOf: [{ required: ['id'] }, { required: ['name'] }] },
        { anyOf: [{ required: ['limit'] }, { required: ['cursor'] }] }
      ]
    }
    const generated = { id: 'row-1', name: null, limit: 1, cursor: null }

    expect(generates(schema, generated)).toBe(true)
    expect(generates(schema, { id: null, name: null, limit: 1, cursor: null })).toBe(false)
    expect(generates(schema, { id: 'row-1', name: null, limit: null, cursor: null })).toBe(false)
    expect(toToolArguments(schema, generated)).toEqual({ id: 'row-1', limit: 1 })
  })

  it('follows a chain of references in an allOf part without dropping the other parts', () => {
    const schema = {
      allOf: [{ $ref: '#/$defs/Alias' }, { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] }],
      $defs: {
        Alias: { $ref: '#/$defs/Payload' },
        Payload: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }
      }
    }

    expect(generates(schema, { a: 'x', b: 'y' })).toBe(true)
    expect(generates(schema, { a: 'x' })).toBe(false)
  })
})
