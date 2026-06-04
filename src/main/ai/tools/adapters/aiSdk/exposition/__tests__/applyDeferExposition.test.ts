import type { Tool, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'

import { TOOL_INSPECT_TOOL_NAME } from '../../meta/toolInspect'
import { TOOL_INVOKE_TOOL_NAME } from '../../meta/toolInvoke'
import { TOOL_SEARCH_TOOL_NAME } from '../../meta/toolSearch'
import { ToolRegistry } from '../../registry'
import type { ToolDefer, ToolEntry } from '../../types'
import { applyDeferExposition } from '../applyDeferExposition'

function makeEntry(name: string, defer: ToolDefer, descriptionChars = 10): ToolEntry {
  return {
    name,
    namespace: name.includes('__') ? `mcp:${name.split('__')[1]}` : 'web',
    description: 'd',
    defer,
    tool: { description: 'x'.repeat(descriptionChars), inputSchema: {} } as unknown as Tool
  }
}

function buildRegistryWith(entries: ToolEntry[]): { registry: ToolRegistry; tools: ToolSet } {
  const registry = new ToolRegistry()
  const tools: ToolSet = {}
  for (const entry of entries) {
    registry.register(entry)
    tools[entry.name] = entry.tool
  }
  return { registry, tools }
}

describe('applyDeferExposition', () => {
  it('returns ToolSet unchanged when no entries are deferred', () => {
    const { registry, tools } = buildRegistryWith([makeEntry('web__search', 'never'), makeEntry('mcp__a__t', 'auto')])
    const result = applyDeferExposition(tools, registry, 32_000)
    expect(result.tools).toBe(tools)
    expect(result.deferredEntries).toEqual([])
  })

  it('returns undefined / empty unchanged', () => {
    const registry = new ToolRegistry()
    expect(applyDeferExposition(undefined, registry, 32_000)).toEqual({ tools: undefined, deferredEntries: [] })
    expect(applyDeferExposition({}, registry, 32_000)).toEqual({ tools: {}, deferredEntries: [] })
  })

  it('strips always-deferred entries and injects meta-tools', () => {
    const { registry, tools } = buildRegistryWith([
      makeEntry('web__search', 'never'),
      makeEntry('experimental', 'always')
    ])
    const { tools: result, deferredEntries } = applyDeferExposition(tools, registry, 32_000)
    expect(Object.keys(result!).sort()).toEqual(
      [TOOL_INSPECT_TOOL_NAME, TOOL_INVOKE_TOOL_NAME, TOOL_SEARCH_TOOL_NAME, 'web__search'].sort()
    )
    expect(result!['experimental']).toBeUndefined()
    expect(deferredEntries.map((e) => e.name)).toEqual(['experimental'])
  })

  it('strips overflowing auto entries when the pool meets both size and net-savings gates', () => {
    // 5 fat auto entries — pool count >= MIN_AUTO_DEFER_COUNT, total cost
    // overflows 10% of 32k, and savings exceed META_TOOLS_OVERHEAD_TOKENS.
    const heavyAuto = Array.from({ length: 5 }, (_, i) => makeEntry(`mcp__big${i}__t`, 'auto', 8_000))
    const small = makeEntry('web__search', 'never')
    const { registry, tools } = buildRegistryWith([...heavyAuto, small])
    const { tools: result, deferredEntries } = applyDeferExposition(tools, registry, 32_000)
    for (const e of heavyAuto) {
      expect(result![e.name]).toBeUndefined()
    }
    expect(result!['web__search']).toBeDefined()
    expect(result![TOOL_SEARCH_TOOL_NAME]).toBeDefined()
    expect(result![TOOL_INSPECT_TOOL_NAME]).toBeDefined()
    expect(result![TOOL_INVOKE_TOOL_NAME]).toBeDefined()
    expect(deferredEntries.map((e) => e.name).sort()).toEqual(heavyAuto.map((e) => e.name).sort())
  })

  it('keeps a single fat auto entry inline (below minimum-count gate, no meta-tools injected)', () => {
    // One huge entry blows the cost threshold but the pool is too small for
    // search-then-invoke to be a net win — must stay inline.
    const huge = makeEntry('mcp__big__t', 'auto', 50_000)
    const small = makeEntry('web__search', 'never')
    const { registry, tools } = buildRegistryWith([huge, small])
    const { tools: result, deferredEntries } = applyDeferExposition(tools, registry, 32_000)
    expect(result).toBe(tools)
    expect(result![TOOL_SEARCH_TOOL_NAME]).toBeUndefined()
    expect(deferredEntries).toEqual([])
  })

  it('skips entries that have a tool but no registry entry', () => {
    const registry = new ToolRegistry()
    const tools: ToolSet = {
      orphan: { description: 'o', inputSchema: {} } as unknown as Tool
    }
    const result = applyDeferExposition(tools, registry, 32_000)
    expect(result.tools).toBe(tools)
    expect(result.deferredEntries).toEqual([])
  })
})
