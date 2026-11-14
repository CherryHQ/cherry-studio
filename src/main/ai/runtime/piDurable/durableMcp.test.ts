import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { CodemodeSandbox } from '@earendil-works/pi-codemode'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode'
import { MemoryStorage } from '@earendil-works/pi-durable/storage/memory'
import { createToolSearchExtension } from '@earendil-works/pi-durable/tool-search'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createDurableMcp } from './durableMcp'

describe('Durable desktop MCP', () => {
  // Catches transport-only registration that lists a tool but cannot return its result through the native loop.
  it('executes registered MCP tools and preserves result details and tool replay policy', async () => {
    const bridge = await createDurableMcp({
      automation: {
        name: 'automation',
        async connect(transport) {
          const server = new McpServer({ name: 'fixture', version: '1' })
          server.registerTool(
            'echo',
            {
              description: 'echo',
              inputSchema: z.object({ text: z.string() }),
              outputSchema: z.object({ echoed: z.string() }),
              annotations: { readOnlyHint: true }
            },
            async ({ text }) => ({ content: [{ type: 'text', text }], structuredContent: { echoed: text } })
          )
          server.registerTool('write', { description: 'mutates', inputSchema: z.object({}) }, async () => ({
            content: [{ type: 'text', text: 'written' }]
          }))
          return serveStdio(() => server, { transport })
        }
      }
    })
    const registry = createRegistry()
    registry.install(bridge.extension)
    const fake = fauxProvider({ tokensPerSecond: 10000 })
    fake.setResponses([
      fauxAssistantMessage(fauxToolCall('mcp__automation__echo', { text: 'MCP_RESULT' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('complete')
    ])
    const models = createModels()
    models.setProvider(fake.provider)
    const native = await Harness.open(new MemoryStorage(), { registry, models }, BACKGROUND_CONTEXT)
    try {
      const root = await native.createConversation(
        { ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
        BACKGROUND_CONTEXT
      )
      const submission = await root.submit({ type: 'input', content: 'run MCP', requestId: 'test' }, BACKGROUND_CONTEXT)
      native.resume()
      await submission.wait(BACKGROUND_CONTEXT)
      const entries = await root.entries({ order: 'ascending' }, 100, undefined, BACKGROUND_CONTEXT)
      const result = entries.items
        .flatMap((entry) => entry.model ?? [])
        .find((message) => message.role === 'toolResult')
      expect(result).toMatchObject({
        isError: false,
        content: [{ type: 'text', text: 'MCP_RESULT' }],
        details: { echoed: 'MCP_RESULT' }
      })
      expect(bridge.extension.tools?.find((tool) => tool.name === 'mcp__automation__echo')?.replay).toBe('safe')
      expect(bridge.extension.tools?.find((tool) => tool.name === 'mcp__automation__write')?.replay).toBe('unsafe')
    } finally {
      await native.close(BACKGROUND_CONTEXT)
      await bridge.close()
    }
  })

  // Catches missing discovery/loading and script access that incorrectly depends on loading.
  it('discovers non-automation MCP memory tools through tool_search while preserving codemode calls', async () => {
    const bridge = await createDurableMcp({
      'agent-memory': {
        id: 'agent-memory',
        name: 'agent-memory',
        async connect(transport) {
          const server = new McpServer({ name: 'fixture', version: '1' })
          server.registerTool(
            'memory',
            { description: 'Read memory', inputSchema: z.object({ text: z.string() }) },
            async ({ text }) => ({ content: [{ type: 'text', text }] })
          )
          server.registerTool(
            'disabled_memory',
            { description: 'Read disabled memory', inputSchema: z.object({ text: z.string() }) },
            async ({ text }) => ({ content: [{ type: 'text', text }] })
          )
          return serveStdio(() => server, { transport })
        }
      }
    })
    const registry = createRegistry()
    registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox(), models: false }))
    registry.install(createToolSearchExtension())
    registry.install(bridge.extension)
    const fake = fauxProvider({ tokensPerSecond: 10000 })
    fake.setResponses([
      fauxAssistantMessage(
        fauxToolCall('codemode', {
          code: `const matches = await searchTools('memory', { limit: 20 });
if (!matches.some(tool => tool.name === 'mcp__agent_memory__memory')) throw new Error('Memory not discoverable');
if (matches.some(tool => tool.name === 'mcp__agent_memory__disabled_memory')) throw new Error('Disabled memory discoverable');
if ('mcp__agent_memory__disabled_memory' in tools) throw new Error('Disabled memory callable');
return await tools.mcp__agent_memory__memory({ text: 'PRE_LOAD' });`
        }),
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage('pre-load script complete'),
      fauxAssistantMessage(fauxToolCall('tool_search', { query: 'memory', limit: 20 }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('search complete'),
      fauxAssistantMessage(fauxToolCall('mcp__agent_memory__memory', { text: 'DIRECT_LOAD' }), {
        stopReason: 'toolUse'
      }),
      fauxAssistantMessage('direct call complete'),
      fauxAssistantMessage(
        fauxToolCall('codemode', {
          code: "return await tools.mcp__agent_memory__memory({ text: 'POST_LOAD' })"
        }),
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage('post-load script complete')
    ])
    const models = createModels()
    models.setProvider(fake.provider)
    const native = await Harness.open(new MemoryStorage(), { registry, models }, BACKGROUND_CONTEXT)
    try {
      const root = await native.createConversation(
        {
          ownership: { kind: 'ownerless' },
          agent: {
            model: { provider: 'faux', modelId: 'faux-1' },
            tools: {
              remove: bridge.extension.tools!.filter((tool) => tool.name === 'mcp__agent_memory__disabled_memory')
            }
          }
        },
        BACKGROUND_CONTEXT
      )
      const before = await root.submit(
        { type: 'input', content: 'discover and call memory before loading', requestId: 'before' },
        BACKGROUND_CONTEXT
      )
      native.resume()
      await before.wait(BACKGROUND_CONTEXT)
      const search = await root.submit(
        { type: 'input', content: 'find memory', requestId: 'search' },
        BACKGROUND_CONTEXT
      )
      await search.wait(BACKGROUND_CONTEXT)
      const direct = await root.submit(
        { type: 'input', content: 'call memory directly', requestId: 'direct' },
        BACKGROUND_CONTEXT
      )
      await direct.wait(BACKGROUND_CONTEXT)
      const after = await root.submit(
        { type: 'input', content: 'call memory from script after loading', requestId: 'after' },
        BACKGROUND_CONTEXT
      )
      await after.wait(BACKGROUND_CONTEXT)
      const entries = await root.entries({ order: 'ascending' }, 100, undefined, BACKGROUND_CONTEXT)
      const results = entries.items
        .flatMap((entry) => entry.model ?? [])
        .filter((message) => message.role === 'toolResult')
      const scripts = results.filter((message) => message.toolName === 'codemode')
      expect(scripts[0]).toMatchObject({
        isError: false,
        content: expect.arrayContaining([{ type: 'text', text: 'PRE_LOAD' }])
      })
      const found = results.find((message) => message.toolName === 'tool_search')
      expect(found).toMatchObject({
        isError: false,
        details: { loaded: expect.arrayContaining(['mcp__agent_memory__memory']) }
      })
      expect(found?.details).toMatchObject({
        loaded: expect.not.arrayContaining(['mcp__agent_memory__disabled_memory'])
      })
      expect(JSON.stringify(found?.content)).not.toContain('mcp__agent_memory__disabled_memory')
      expect(results.find((message) => message.toolName === 'mcp__agent_memory__memory')).toMatchObject({
        isError: false,
        content: expect.arrayContaining([{ type: 'text', text: 'DIRECT_LOAD' }])
      })
      expect(scripts[1]).toMatchObject({
        isError: false,
        content: expect.arrayContaining([{ type: 'text', text: 'POST_LOAD' }])
      })
    } finally {
      await native.close(BACKGROUND_CONTEXT)
      await bridge.close()
    }
  })
})
