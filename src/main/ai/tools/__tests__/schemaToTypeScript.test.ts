import { describe, expect, it } from 'vitest'

import { jsonSchemaToTypeScript, toolsToTypeScript, toolToTypeScript } from '../codeMode/schemaToTypeScript'

describe('jsonSchemaToTypeScript', () => {
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
