import type { Tool, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'

import { applyToolProfile, type ToolProfile } from '../profile'
import { READ_ONLY_PROFILE } from '../profiles/readOnly'
import { ToolRegistry } from '../registry'
import {
  BuiltinToolNamespace,
  MetaToolName,
  ToolCapability,
  ToolDefer,
  type ToolEntry,
  type ToolNamespace
} from '../types'

function entry(
  name: string,
  namespace: ToolNamespace,
  capability?: ToolCapability,
  defer: ToolDefer = ToolDefer.Never
): ToolEntry {
  return {
    name,
    namespace,
    description: `${name} description`,
    defer,
    capability,
    tool: { description: '', inputSchema: { type: 'object' } } as unknown as Tool
  }
}

function makeRegistry(entries: ToolEntry[]): ToolRegistry {
  const r = new ToolRegistry()
  for (const e of entries) r.register(e)
  return r
}

function makeToolSet(names: string[]): ToolSet {
  const out: ToolSet = {}
  for (const n of names) out[n] = { description: '', inputSchema: { type: 'object' } } as unknown as Tool
  return out
}

describe('applyToolProfile', () => {
  it('returns undefined when input is empty', () => {
    expect(applyToolProfile(undefined, new ToolRegistry(), {})).toBeUndefined()
  })

  it('keeps only tools in allowNamespaces', () => {
    const reg = makeRegistry([
      entry('web__search', BuiltinToolNamespace.Web, ToolCapability.Read),
      entry('kb__search', BuiltinToolNamespace.Kb, ToolCapability.Read),
      entry('mcp__fs__read', 'mcp:fs', ToolCapability.Read)
    ])
    const tools = makeToolSet(['web__search', 'kb__search', 'mcp__fs__read'])
    const profile: ToolProfile = { allowNamespaces: [BuiltinToolNamespace.Web] }
    const filtered = applyToolProfile(tools, reg, profile)
    expect(Object.keys(filtered ?? {})).toEqual(['web__search'])
  })

  it('keeps only tools matching allowCapabilities', () => {
    const reg = makeRegistry([
      entry('web__search', BuiltinToolNamespace.Web, ToolCapability.Read),
      entry('mcp__fs__write', 'mcp:fs', ToolCapability.Write)
    ])
    const tools = makeToolSet(['web__search', 'mcp__fs__write'])
    const filtered = applyToolProfile(tools, reg, { allowCapabilities: [ToolCapability.Read] })
    expect(Object.keys(filtered ?? {})).toEqual(['web__search'])
  })

  it('lets MCP server through allowMcpServers even without capability tag', () => {
    const reg = makeRegistry([entry('mcp__fs__read', 'mcp:fs'), entry('mcp__blender__render', 'mcp:blender')])
    const tools = makeToolSet(['mcp__fs__read', 'mcp__blender__render'])
    const filtered = applyToolProfile(tools, reg, { allowMcpServers: ['fs'] })
    expect(Object.keys(filtered ?? {})).toEqual(['mcp__fs__read'])
  })

  it('blockNames overrides include rules', () => {
    const reg = makeRegistry([entry('web__search', BuiltinToolNamespace.Web, ToolCapability.Read)])
    const tools = makeToolSet(['web__search'])
    const filtered = applyToolProfile(tools, reg, {
      allowCapabilities: [ToolCapability.Read],
      blockNames: ['web__search']
    })
    expect(filtered).toBeUndefined()
  })

  it('drops tools not classified by registry or meta table (opt-in safety)', () => {
    const reg = makeRegistry([])
    const tools = makeToolSet(['orphan_tool'])
    const filtered = applyToolProfile(tools, reg, { allowNamespaces: [BuiltinToolNamespace.Web] })
    expect(filtered).toBeUndefined()
  })

  it('classifies meta-tools by name (not in registry)', () => {
    const reg = makeRegistry([])
    const tools = makeToolSet([MetaToolName.Search, MetaToolName.Exec])
    const filtered = applyToolProfile(tools, reg, {
      allowNamespaces: [BuiltinToolNamespace.Meta],
      allowCapabilities: [ToolCapability.Read]
    })
    // Search is Read-capable meta → kept. Exec is Compute → kept too (allowNamespaces).
    expect(Object.keys(filtered ?? {}).sort()).toEqual([MetaToolName.Exec, MetaToolName.Search].sort())
  })

  describe('READ_ONLY_PROFILE', () => {
    it('keeps web/kb readers + meta-search/inspect, blocks compute meta-tools', () => {
      const reg = makeRegistry([
        entry('web__search', BuiltinToolNamespace.Web, ToolCapability.Read),
        entry('kb__search', BuiltinToolNamespace.Kb, ToolCapability.Read),
        entry('mcp__blender__render', 'mcp:blender', ToolCapability.Write)
      ])
      const tools = makeToolSet([
        'web__search',
        'kb__search',
        'mcp__blender__render',
        MetaToolName.Search,
        MetaToolName.Inspect,
        MetaToolName.Agent,
        MetaToolName.Exec,
        MetaToolName.Invoke
      ])
      const filtered = applyToolProfile(tools, reg, READ_ONLY_PROFILE)
      expect(Object.keys(filtered ?? {}).sort()).toEqual(
        ['web__search', 'kb__search', MetaToolName.Search, MetaToolName.Inspect].sort()
      )
    })
  })
})
