import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { MemoryStorage } from '@earendil-works/pi-durable/storage/memory'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { buildMcpToolWireId } from '@main/ai/mcp/mcpToolId'
import { buildMcpWireWildcard, buildMcpWireToolId } from '@shared/ai/tools/mcpSourcePolicy'
import { McpServerSchema } from '@shared/data/types/mcpServer'

import { buildPiMcpToolName } from '../pi/piMcpExtension'
import { createDurableMcp } from './durableMcp'

describe('Durable desktop MCP', () => {
  it.each(['raw', 'legacy', 'catalog', 'wildcard', 'unmatched'] as const)(
    'resolves %s source approval rules against native tool identities',
    async (rule) => {
      const source = McpServerSchema.parse({
        id: '12345678-1234-4234-8234-123456789abc',
        name: 'speaker-server',
        isActive: true
      })
      const values = {
        raw: 'play',
        legacy: buildMcpWireToolId(source.name, 'play'),
        catalog: buildMcpToolWireId({ serverId: source.id, serverName: source.name, toolName: 'play' }),
        wildcard: buildMcpWireWildcard(source.name),
        unmatched: 'mcp__other__*'
      }
      source.disabledAutoApproveTools = [values[rule]]
      const bridge = await createDurableMcp({
        [source.id]: {
          id: source.id,
          name: source.id,
          source,
          async connect(transport) {
            const server = new McpServer({ name: 'speaker', version: '1' })
            server.registerTool('play', { inputSchema: z.object({}) }, async () => ({ content: [] }))
            server.registerTool('pause', { inputSchema: z.object({}) }, async () => ({ content: [] }))
            return serveStdio(() => server, { transport })
          }
        }
      })
      try {
        expect(bridge.approvalRequiredTools.has(buildPiMcpToolName(source.id, 'play'))).toBe(rule !== 'unmatched')
        expect(bridge.approvalRequiredTools.has(buildPiMcpToolName(source.id, 'pause'))).toBe(rule === 'wildcard')
        expect([...bridge.nonBypassableApprovalTools]).toEqual(
          rule === 'wildcard' ? [buildPiMcpToolName(source.id, 'play'), buildPiMcpToolName(source.id, 'pause')] : []
        )
      } finally {
        await bridge.close()
      }
    }
  )

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
})
