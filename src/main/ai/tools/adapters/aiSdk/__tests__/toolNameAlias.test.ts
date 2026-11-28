import { jsonSchema, type Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { mcpProtocolName, resolveRequestToolName, resolveToolNameAlias } from '../toolNameAlias'

const mcpTool = (protocolName: string): Tool => ({
  type: 'function',
  description: protocolName,
  inputSchema: jsonSchema({ type: 'object' }),
  metadata: { cherry: { tool: { name: protocolName, serverId: 's1', serverName: 'S1', type: 'mcp' } } }
})

const builtinTool = (): Tool => ({
  type: 'function',
  description: 'builtin',
  inputSchema: jsonSchema({ type: 'object' })
})

describe('mcpProtocolName', () => {
  it('reads the protocol name from cherry metadata', () => {
    expect(mcpProtocolName(mcpTool('nmap_scan'))).toBe('nmap_scan')
  })

  it('returns undefined for tools without cherry MCP metadata', () => {
    expect(mcpProtocolName(builtinTool())).toBeUndefined()
    expect(mcpProtocolName(undefined)).toBeUndefined()
  })
})

describe('resolveToolNameAlias', () => {
  it('maps a protocol name to the unique wire id carrying it', () => {
    const tools = new Map([
      ['mcp__s1__nmap_scan_a1b2c3', mcpTool('nmap_scan')],
      ['web_search', builtinTool()]
    ])
    expect(resolveToolNameAlias('nmap_scan', tools.keys(), (n) => tools.get(n))).toEqual({
      resolved: 'mcp__s1__nmap_scan_a1b2c3'
    })
  })

  it('returns undefined when no candidate exposes the alias', () => {
    const tools = new Map([['mcp__s1__nmap_scan_a1b2c3', mcpTool('nmap_scan')]])
    expect(resolveToolNameAlias('fofa_search', tools.keys(), (n) => tools.get(n))).toBeUndefined()
  })

  it('skips exact-name candidates (callers resolve exact names before aliasing)', () => {
    const tools = new Map([
      ['nmap_scan', builtinTool()],
      ['mcp__s1__nmap_scan_a1b2c3', mcpTool('nmap_scan')]
    ])
    expect(resolveToolNameAlias('nmap_scan', tools.keys(), (n) => tools.get(n))).toEqual({
      resolved: 'mcp__s1__nmap_scan_a1b2c3'
    })
  })

  it('reports ambiguity when two candidates share the protocol name', () => {
    const tools = new Map([
      ['mcp__s1__nmap_scan_a1b2c3', mcpTool('nmap_scan')],
      ['mcp__s2__nmap_scan_d4e5f6', mcpTool('nmap_scan')]
    ])
    const result = resolveToolNameAlias('nmap_scan', tools.keys(), (n) => tools.get(n))
    expect(result).toEqual({ ambiguous: ['mcp__s1__nmap_scan_a1b2c3', 'mcp__s2__nmap_scan_d4e5f6'] })
  })
})

describe('resolveRequestToolName', () => {
  const tools = new Map([
    ['mcp__s1__nmap_scan_a1b2c3', mcpTool('nmap_scan')],
    ['web_search', builtinTool()]
  ])
  const allowed = new Set(tools.keys())
  const getTool = (n: string) => tools.get(n)

  it('passes through an exact allowed name', () => {
    expect(resolveRequestToolName('web_search', allowed, getTool)).toBe('web_search')
  })

  it('bridges a protocol-name alias to its wire id', () => {
    expect(resolveRequestToolName('nmap_scan', allowed, getTool)).toBe('mcp__s1__nmap_scan_a1b2c3')
  })

  it('throws with the reason when the name is unknown to the request', () => {
    expect(() => resolveRequestToolName('fofa_search', allowed, getTool)).toThrow(/not available in this request/)
    expect(() => resolveRequestToolName('fofa_search', allowed, getTool)).toThrow(/no enabled tool exposes this name/)
  })

  it('throws naming the candidates when the alias is ambiguous', () => {
    tools.set('mcp__s2__nmap_scan_d4e5f6', mcpTool('nmap_scan'))
    const wide = new Set(tools.keys())
    expect(() => resolveRequestToolName('nmap_scan', wide, getTool)).toThrow(/matches mcp__s1__nmap_scan_a1b2c3 and/)
    tools.delete('mcp__s2__nmap_scan_d4e5f6')
  })
})
