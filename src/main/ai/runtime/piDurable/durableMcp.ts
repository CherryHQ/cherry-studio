import type { JsonValue } from '@earendil-works/chord'
import type { TextContent, ImageContent } from '@earendil-works/pi-ai'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

import { MCP_FORWARDING_TIMEOUT_MS } from '@main/ai/mcp/mcpRequestOptions'

import type { AgentMcpServer } from '../agentMcpServers'
import { buildPiMcpToolName } from '../pi/piMcpExtension'

/** Native Durable tools retain replay policy; MCP remains a desktop transport. */
export async function createDurableMcp(servers: Record<string, AgentMcpServer>) {
  const [{ defineTool, defineExtension }, { Type }] = await Promise.all([
    import('@earendil-works/pi-durable'),
    import('@earendil-works/pi-ai')
  ])
  const clients: Client[] = []
  const metadata = new Map<string, { type: 'mcp'; name: string; serverId: string; serverName: string }>()
  const close = () => Promise.all(clients.map((client) => client.close())).then(() => undefined)
  const tools: ToolRegistration[] = []
  try {
    for (const server of Object.values(servers)) {
      const client = new Client(
        { name: 'cherry-pi-durable', version: '1' },
        { versionNegotiation: { mode: { pin: '2026-07-28' }, probe: { timeoutMs: 10_000, maxRetries: 0 } } }
      )
      clients.push(client)
      const [local, remote] = InMemoryTransport.createLinkedPair()
      await server.connect(remote)
      await client.connect(local)
      const catalog: Awaited<ReturnType<Client['listTools']>>['tools'] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : {})
        catalog.push(...page.tools)
        cursor = page.nextCursor
      } while (cursor)
      const serverId = server.id ?? server.name
      const names = catalog.map((tool) => buildPiMcpToolName(serverId, tool.name))
      for (const tool of catalog) {
        const raw = buildPiMcpToolName(serverId, tool.name)
        const name = buildPiMcpToolName(serverId, tool.name, names.indexOf(raw) !== names.lastIndexOf(raw))
        metadata.set(name, { type: 'mcp', name: tool.name, serverId, serverName: server.name })
        tools.push(
          defineTool({
            name,
            description: tool.description ?? tool.name,
            parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
            ...(tool.outputSchema && { structuredOutputSchema: Type.Unsafe(tool.outputSchema) }),
            replay: tool.annotations?.readOnlyHint === true ? 'safe' : 'unsafe',
            callers: serverId === 'automation' ? ['model', 'tools'] : ['tools'],
            async execute(args, _api, context) {
              const result = await client.callTool(
                { name: tool.name, arguments: args },
                {
                  signal: context.abortSignal,
                  timeout: MCP_FORWARDING_TIMEOUT_MS
                }
              )
              if (!('content' in result)) throw new Error('MCP returned no tool content')
              const content = result.content.flatMap<TextContent | ImageContent>((part) => {
                if (part.type === 'text') return [{ type: 'text' as const, text: part.text }]
                if (part.type === 'image') return [{ type: 'image' as const, data: part.data, mimeType: part.mimeType }]
                return [{ type: 'text' as const, text: JSON.stringify(part) }]
              })
              return {
                output: content,
                isError: result.isError === true,
                ...(result.structuredContent
                  ? {
                      details: result.structuredContent as JsonValue,
                      ...(tool.outputSchema && { structuredOutput: result.structuredContent as JsonValue })
                    }
                  : {})
              }
            }
          })
        )
      }
    }
    return { extension: defineExtension({ name: 'cherry.mcp', tools }), metadata, close }
  } catch (error) {
    await close()
    throw error
  }
}
