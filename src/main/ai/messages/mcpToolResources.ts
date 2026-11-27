import { EmbeddedResourceSchema } from '@modelcontextprotocol/core'
import { isToolUIPart, type UIMessage } from 'ai'

import type { McpResource } from '@shared/types/mcp'

export function mcpToolResourceKey(serverId: string, uri: string): string {
  return JSON.stringify([serverId, uri])
}

export function registerMcpToolResources(
  resources: Map<string, McpResource>,
  output: unknown,
  source: { serverId: string; serverName: string }
): void {
  if (!output || typeof output !== 'object' || !('content' in output) || !Array.isArray(output.content)) return
  if ('isError' in output && output.isError) return
  for (const item of output.content) {
    const parsed = EmbeddedResourceSchema.safeParse(item)
    if (!parsed.success) continue
    const resource = parsed.data.resource
    resources.set(mcpToolResourceKey(source.serverId, resource.uri), {
      ...resource,
      ...source,
      name: resource.uri
    })
  }
}

/** Only assistant tool results grant access; user text and tool arguments never do. */
export function collectMcpToolResources(messages: UIMessage[]): Map<string, McpResource> {
  const resources = new Map<string, McpResource>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== 'output-available') continue
      const output = part.output
      if (!output || typeof output !== 'object' || !('metadata' in output)) continue
      const metadata = output.metadata
      if (!metadata || typeof metadata !== 'object' || !('type' in metadata) || metadata.type !== 'mcp') continue
      if (!('serverId' in metadata) || typeof metadata.serverId !== 'string') continue
      if (!('serverName' in metadata) || typeof metadata.serverName !== 'string') continue
      registerMcpToolResources(resources, output, { serverId: metadata.serverId, serverName: metadata.serverName })
    }
  }
  return resources
}
