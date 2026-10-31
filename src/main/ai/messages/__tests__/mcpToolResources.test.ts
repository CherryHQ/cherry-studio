import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { collectMcpToolResources, mcpToolResourceKey, registerMcpToolResources } from '../mcpToolResources'

const resource = { uri: 'memory://report', mimeType: 'text/plain', blob: 'aGVsbG8=' }
const server = { serverId: 'server-1', serverName: 'Reports', type: 'mcp' }

describe('MCP tool resource read-back', () => {
  it('keeps server identities separate and reads the latest result for a resource URI', () => {
    const resources = new Map()
    registerMcpToolResources(resources, { content: [{ type: 'resource', resource }] }, server)
    const updated = { ...resource, blob: 'd29ybGQ=' }
    registerMcpToolResources(resources, { content: [{ type: 'resource', resource: updated }] }, server)

    expect(resources.get(mcpToolResourceKey(server.serverId, updated.uri))?.blob).toBe('d29ybGQ=')
    expect(mcpToolResourceKey('another-server', resource.uri)).not.toBe(
      mcpToolResourceKey(server.serverId, resource.uri)
    )
  })

  it('restores successful MCP resources from assistant history, including tool_invoke', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-tool_invoke',
            toolCallId: 'call-1',
            state: 'output-available',
            input: {},
            output: { content: [{ type: 'resource', resource }], metadata: server }
          }
        ]
      }
    ] as UIMessage[]

    const resources = collectMcpToolResources(messages)
    expect(resources.get(mcpToolResourceKey(server.serverId, resource.uri))?.blob).toBe('aGVsbG8=')
    expect(collectMcpToolResources([]).size).toBe(0)
    expect(collectMcpToolResources([{ ...messages[0], role: 'user' }]).size).toBe(0)
  })

  it('does not grant a read for errors, invalid resources or arbitrary resource links', () => {
    const resources = new Map()
    registerMcpToolResources(resources, { isError: true, content: [{ type: 'resource', resource }] }, server)
    registerMcpToolResources(
      resources,
      { content: [{ type: 'resource', resource: { uri: 'file:///secret' } }] },
      server
    )
    registerMcpToolResources(resources, { content: [{ type: 'resource_link', uri: 'file:///secret' }] }, server)
    expect(resources.size).toBe(0)
  })
})
