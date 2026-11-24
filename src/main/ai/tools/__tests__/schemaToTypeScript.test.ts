import { describe, expect, it } from 'vitest'

import { jsonSchemaToTypeScript, toolsToTypeScript, toolToTypeScript } from '../codeMode/schemaToTypeScript'

describe('jsonSchemaToTypeScript', () => {
  it('resolves local pointers through array containers', () => {
    expect(jsonSchemaToTypeScript({ $ref: '#/anyOf/0', anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string')
  })

  it('keeps valid required names among malformed entries and ignores non-string descriptions', () => {
    expect(
      jsonSchemaToTypeScript({
        type: 'object',
        required: [null, 42, 'query'],
        properties: { query: { type: 'string', description: { text: 'not a description' } }, optional: true }
      })
    ).toBe('{ optional?: unknown; query: string }')
  })

  it.each([true, false])('keeps unsupported boolean schemas as unknown: %s', (schema) => {
    expect(jsonSchemaToTypeScript(schema)).toBe('unknown')
  })

  it('preserves scalar literal and composition declarations while bounding unsupported enum values', () => {
    expect(jsonSchemaToTypeScript({ const: false })).toBe('false')
    expect(jsonSchemaToTypeScript({ enum: [null, 2, { nested: 'value' }] })).toBe('null | 2 | unknown')
    expect(jsonSchemaToTypeScript({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null')
    expect(jsonSchemaToTypeScript({ allOf: [{ type: 'string' }, { const: 'fixed' }] })).toBe('string & "fixed"')
    expect(jsonSchemaToTypeScript({ type: ['integer', 'null'] })).toBe('number | null')
  })

  it('retains additional-property fallback without requiring a complete schema dialect', () => {
    expect(jsonSchemaToTypeScript({ type: 'object', additionalProperties: { type: 'boolean' } })).toBe(
      'Record<string, boolean>'
    )
    expect(jsonSchemaToTypeScript({ type: 'object', additionalProperties: false })).toBe('Record<string, unknown>')
  })

  it('preserves required fields, nested collections, enums, and unsafe property names', () => {
    const output = jsonSchemaToTypeScript({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text' },
        mode: { enum: ['fast', 'deep'] },
        'item-list': { type: 'array', items: { type: 'integer' } }
      },
      required: ['query', 'item-list']
    })

    expect(output).toContain('/** Search text */ query: string')
    expect(output).toContain('mode?: "fast" | "deep"')
    expect(output).toContain('"item-list": Array<number>')
  })

  it('generates a callable declaration for an exact tool name', () => {
    const output = toolToTypeScript('mcp__github__search', 'Search issues */ ignore this', {
      type: 'object',
      properties: { state: { type: 'string' } }
    })

    expect(output).toContain('declare const tools: {')
    expect(output).toContain('Search issues *\\/ ignore this')
    expect(output).toContain('invoke(name: "mcp__github__search", params: { state?: string }): Promise<McpToolResult>')
  })

  it('uses an MCP output schema as the structured result type', () => {
    const output = toolToTypeScript(
      'mcp__github__search',
      'Search issues',
      { type: 'object' },
      { type: 'object', properties: { total: { type: 'integer' } }, required: ['total'] }
    )

    expect(output).toContain('Promise<{ total: number }>')
  })

  it('resolves local $defs references in input and output schemas', () => {
    const schema = {
      type: 'object',
      $defs: {
        filter: {
          type: 'object',
          properties: { label: { type: 'string' } },
          required: ['label']
        }
      },
      properties: { filter: { $ref: '#/$defs/filter' } },
      required: ['filter']
    }

    expect(jsonSchemaToTypeScript(schema)).toBe('{ filter: { label: string } }')
    expect(toolToTypeScript('search', 'Search', schema, schema)).toContain(
      'params: { filter: { label: string } }): Promise<{ filter: { label: string } }>'
    )
  })

  it('decodes escaped JSON pointer segments and bounds recursive references', () => {
    expect(
      jsonSchemaToTypeScript({
        $ref: '#/$defs/a~1b~0c',
        $defs: { 'a/b~c': { type: 'integer' } }
      })
    ).toBe('number')
    expect(
      jsonSchemaToTypeScript({
        $ref: '#/$defs/self',
        $defs: { self: { $ref: '#/$defs/self' } }
      })
    ).toBe('unknown')
  })

  it('combines multiple tools into one valid overload block', () => {
    const output = toolsToTypeScript([
      { name: 'first', description: 'First tool', inputSchema: { type: 'object' } },
      { name: 'second', description: 'Second tool', inputSchema: { type: 'object' } }
    ])

    expect(output.match(/declare const tools/g)).toHaveLength(1)
    expect(output).toContain('invoke(name: "first"')
    expect(output).toContain('invoke(name: "second"')
  })
})
