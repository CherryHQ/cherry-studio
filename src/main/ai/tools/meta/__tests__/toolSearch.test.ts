import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '../../registry'
import type { ToolEntry } from '../../types'
import { createToolSearchTool, TOOL_SEARCH_TOOL_NAME } from '../toolSearch'

function makeEntry(overrides: Partial<ToolEntry> & Pick<ToolEntry, 'name'>): ToolEntry {
  return {
    namespace: 'mcp:s1',
    description: `${overrides.name} description`,
    defer: 'auto',
    tool: { description: 'inner', inputSchema: { type: 'object' } } as unknown as Tool,
    ...overrides
  }
}

function setup() {
  const reg = new ToolRegistry()
  reg.register(makeEntry({ name: 'mcp__s1__a', namespace: 'mcp:s1' }))
  reg.register(makeEntry({ name: 'mcp__s1__b', namespace: 'mcp:s1' }))
  reg.register(makeEntry({ name: 'mcp__s2__c', namespace: 'mcp:s2' }))
  reg.register(makeEntry({ name: 'web__search', namespace: 'web', defer: 'never' }))
  return reg
}

async function callExecute(tool: Tool, args: { query?: string; namespace?: string; verbose?: boolean }) {
  if (typeof tool.execute !== 'function') throw new Error('not executable')
  return tool.execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', abortSignal: new AbortController().signal }
  } as Parameters<NonNullable<Tool['execute']>>[1])
}

describe('tool_search meta-tool', () => {
  it('TOOL_SEARCH_TOOL_NAME is the agreed wire-name', () => {
    expect(TOOL_SEARCH_TOOL_NAME).toBe('tool_search')
  })

  it('groups deferred entries by namespace, drops non-deferred', async () => {
    const reg = setup()
    const deferred = new Set(['mcp__s1__a', 'mcp__s1__b', 'mcp__s2__c'])
    const tool = createToolSearchTool(reg, deferred)
    const result = (await callExecute(tool, {})) as {
      matchedNamespaces: Array<{ namespace: string; tools: Array<{ name: string }> }>
    }
    const names = result.matchedNamespaces.map((g) => g.namespace).sort()
    expect(names).toEqual(['mcp:s1', 'mcp:s2'])
    expect(
      result.matchedNamespaces
        .find((g) => g.namespace === 'mcp:s1')!
        .tools.map((t) => t.name)
        .sort()
    ).toEqual(['mcp__s1__a', 'mcp__s1__b'])
  })

  it('does not surface tools that are inline (i.e. not in deferred set)', async () => {
    const reg = setup()
    const deferred = new Set(['mcp__s1__a']) // only one deferred
    const tool = createToolSearchTool(reg, deferred)
    const result = (await callExecute(tool, {})) as { matchedNamespaces: Array<{ tools: Array<{ name: string }> }> }
    const allNames = result.matchedNamespaces.flatMap((g) => g.tools.map((t) => t.name))
    expect(allNames).toEqual(['mcp__s1__a'])
  })

  it('filters by query (substring across name/description/namespace)', async () => {
    const reg = setup()
    const deferred = new Set(['mcp__s1__a', 'mcp__s1__b', 'mcp__s2__c'])
    const tool = createToolSearchTool(reg, deferred)
    const result = (await callExecute(tool, { query: 's2' })) as {
      matchedNamespaces: Array<{ namespace: string }>
    }
    expect(result.matchedNamespaces.map((g) => g.namespace)).toEqual(['mcp:s2'])
  })

  it('filters by namespace', async () => {
    const reg = setup()
    const deferred = new Set(['mcp__s1__a', 'mcp__s1__b', 'mcp__s2__c'])
    const tool = createToolSearchTool(reg, deferred)
    const result = (await callExecute(tool, { namespace: 'mcp:s1' })) as {
      matchedNamespaces: Array<{ namespace: string; tools: Array<{ name: string }> }>
    }
    expect(result.matchedNamespaces).toHaveLength(1)
    expect(result.matchedNamespaces[0].namespace).toBe('mcp:s1')
  })

  it('verbose mode includes inputSchema; default mode omits it', async () => {
    const reg = setup()
    const deferred = new Set(['mcp__s1__a'])
    const tool = createToolSearchTool(reg, deferred)
    const compact = (await callExecute(tool, {})) as {
      matchedNamespaces: Array<{ tools: Array<{ inputSchema?: unknown }> }>
    }
    expect(compact.matchedNamespaces[0].tools[0].inputSchema).toBeUndefined()

    const verbose = (await callExecute(tool, { verbose: true })) as {
      matchedNamespaces: Array<{ tools: Array<{ inputSchema?: unknown }> }>
    }
    expect(verbose.matchedNamespaces[0].tools[0].inputSchema).toBeDefined()
  })
})
