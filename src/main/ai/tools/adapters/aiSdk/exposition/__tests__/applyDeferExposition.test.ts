import { jsonSchema, type Tool, type ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createBrowserToolEntries } from '../../builtin/BrowserTools'
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
  it('returns ToolSet unchanged when no entries are deferred', async () => {
    const { registry, tools } = buildRegistryWith([makeEntry('web_search', 'never'), makeEntry('mcp__a__t', 'auto')])
    const result = await applyDeferExposition(tools, registry, 32_000)
    expect(result.tools).toBe(tools)
    expect(result.deferredEntries).toEqual([])
  })

  it('returns undefined / empty unchanged', async () => {
    const registry = new ToolRegistry()
    expect(await applyDeferExposition(undefined, registry, 32_000)).toEqual({ tools: undefined, deferredEntries: [] })
    expect(await applyDeferExposition({}, registry, 32_000)).toEqual({ tools: {}, deferredEntries: [] })
  })

  it('strips always-deferred entries and injects meta-tools', async () => {
    const { registry, tools } = buildRegistryWith([
      makeEntry('web_search', 'never'),
      makeEntry('experimental', 'always')
    ])
    const { tools: result, deferredEntries } = await applyDeferExposition(tools, registry, 32_000)
    expect(Object.keys(result!).sort()).toEqual(
      [TOOL_INSPECT_TOOL_NAME, TOOL_INVOKE_TOOL_NAME, TOOL_SEARCH_TOOL_NAME, 'web_search'].sort()
    )
    expect(result!['experimental']).toBeUndefined()
    expect(deferredEntries.map((e) => e.name)).toEqual(['experimental'])
  })

  it('strips overflowing auto entries when the pool meets both size and net-savings gates', async () => {
    // 5 fat auto entries — pool count >= MIN_AUTO_DEFER_COUNT, total cost
    // overflows 10% of 32k, and savings exceed META_TOOLS_OVERHEAD_TOKENS.
    const heavyAuto = Array.from({ length: 5 }, (_, i) => makeEntry(`mcp__big${i}__t`, 'auto', 8_000))
    const small = makeEntry('web_search', 'never')
    const { registry, tools } = buildRegistryWith([...heavyAuto, small])
    const { tools: result, deferredEntries } = await applyDeferExposition(tools, registry, 32_000)
    for (const e of heavyAuto) {
      expect(result![e.name]).toBeUndefined()
    }
    expect(result!['web_search']).toBeDefined()
    expect(result![TOOL_SEARCH_TOOL_NAME]).toBeDefined()
    expect(result![TOOL_INSPECT_TOOL_NAME]).toBeDefined()
    expect(result![TOOL_INVOKE_TOOL_NAME]).toBeDefined()
    expect(deferredEntries.map((e) => e.name).sort()).toEqual(heavyAuto.map((e) => e.name).sort())
  })

  it('keeps a single fat auto entry inline (below minimum-count gate, no meta-tools injected)', async () => {
    // One huge entry blows the cost threshold but the pool is too small for
    // search-then-invoke to be a net win — must stay inline.
    const huge = makeEntry('mcp__big__t', 'auto', 50_000)
    const small = makeEntry('web_search', 'never')
    const { registry, tools } = buildRegistryWith([huge, small])
    const { tools: result, deferredEntries } = await applyDeferExposition(tools, registry, 32_000)
    expect(result).toBe(tools)
    expect(result![TOOL_SEARCH_TOOL_NAME]).toBeUndefined()
    expect(deferredEntries).toEqual([])
  })

  async function exposeDeferredTool() {
    const execute = vi.fn().mockResolvedValue('ok')
    const registry = new ToolRegistry()
    const entry: ToolEntry = {
      name: 'mcp__s1__t',
      namespace: 'mcp:s1',
      description: 'd',
      defer: 'always',
      tool: {
        type: 'function',
        description: 'inner',
        inputSchema: jsonSchema({ type: 'object' }),
        execute
      } as unknown as Tool
    }
    registry.register(entry)
    const { tools } = await applyDeferExposition({ mcp__s1__t: entry.tool }, registry, 32_000)
    const opts = {
      toolCallId: 'tc-1',
      messages: [],
      context: { requestId: 'req-1', abortSignal: new AbortController().signal }
    } as Parameters<NonNullable<Tool['execute']>>[1]
    return { execute, inspect: tools![TOOL_INSPECT_TOOL_NAME], invoke: tools![TOOL_INVOKE_TOOL_NAME], opts }
  }

  it('gates the injected tool_invoke on inspection — a deferred tool never runs blind', async () => {
    const { execute, invoke, opts } = await exposeDeferredTool()
    await expect(invoke.execute!({ name: 'mcp__s1__t', params: {} }, opts)).rejects.toThrow(/hasn't been inspected/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('shares one inspect ledger: inspecting via the injected tool_inspect unlocks tool_invoke', async () => {
    const { execute, inspect, invoke, opts } = await exposeDeferredTool()
    await inspect.execute!({ name: 'mcp__s1__t' }, opts)
    const result = await invoke.execute!({ name: 'mcp__s1__t', params: {} }, opts)
    expect(result).toBe('ok')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps deferred browser tools discoverable, inspectable, and callable', async () => {
    const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'opened' }] })
    const entries = createBrowserToolEntries().map((entry) =>
      entry.name === 'browser_open' ? { ...entry, tool: { ...entry.tool, execute } } : entry
    )
    const { registry, tools } = buildRegistryWith(entries)
    const exposed = await applyDeferExposition(tools, registry, 1_000_000)
    const metaTools = exposed.tools!
    const opts = {
      toolCallId: 'browser-1',
      messages: [],
      context: { requestId: 'request-1', topicId: 'topic-1', assistant: { id: 'assistant-1' } }
    } as Parameters<NonNullable<Tool['execute']>>[1]

    expect(metaTools.browser_open).toBeUndefined()
    expect(exposed.deferredEntries.map((entry) => entry.name)).toContain('browser_open')
    const found = await metaTools[TOOL_SEARCH_TOOL_NAME].execute!({ query: 'browser_open', namespace: 'browser' }, opts)
    expect(found.matchedNamespaces[0].tools.map((entry: { name: string }) => entry.name)).toContain('browser_open')
    const signature = await metaTools[TOOL_INSPECT_TOOL_NAME].execute!({ name: 'browser_open' }, opts)
    expect(signature).toContain('browser_open')
    expect(signature).toContain('url')
    const result = await metaTools[TOOL_INVOKE_TOOL_NAME].execute!(
      { name: 'browser_open', params: { url: 'https://example.com' } },
      opts
    )
    expect(result).toEqual({ content: [{ type: 'text', text: 'opened' }] })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com' }),
      expect.objectContaining({ toolCallId: 'browser-1::browser_open' })
    )
  })

  it('skips entries that have a tool but no registry entry', async () => {
    const registry = new ToolRegistry()
    const tools: ToolSet = {
      orphan: { description: 'o', inputSchema: {} } as unknown as Tool
    }
    const result = await applyDeferExposition(tools, registry, 32_000)
    expect(result.tools).toBe(tools)
    expect(result.deferredEntries).toEqual([])
  })
})
