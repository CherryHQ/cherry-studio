import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listToolsTolerant } from '../mcpListTools'

const validTools = [
  { name: 'plain', inputSchema: { type: 'object' }, _meta: { extension: 'preserved' } },
  ...[true, false].map((value) => ({
    name: `state-${value}`,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object', properties: { canonical_state: value } }
  })),
  {
    name: 'flexible-input',
    inputSchema: {
      type: 'object',
      properties: { payload: {}, filter: false, nested: { anyOf: [true, { type: 'string' }] } },
      additionalProperties: false
    },
    extension: { enabled: true }
  }
]

describe('listToolsTolerant', () => {
  let client: Client
  let server: McpServer
  let result: { tools: unknown; nextCursor?: string }

  beforeEach(async () => {
    mockMainLoggerService.warn.mockClear()
    result = { tools: [...validTools, { inputSchema: { type: 'object' } }], nextCursor: 'next-page' }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    server = new McpServer({ name: 'schema-test', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.server.setRequestHandler(ListToolsRequestSchema, async () => result)
    server.server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: 'text', text: 'no structured content' }]
    }))
    await server.connect(serverTransport)
    client = new Client({ name: 'cherry-test', version: '1.0.0' }, { capabilities: {} })
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await server.close()
  })

  it('retains legal subschemas and protocol extensions while skipping a malformed entry', async () => {
    await expect(listToolsTolerant(client)).resolves.toEqual(validTools)
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Skipping invalid MCP tool',
      expect.objectContaining({ toolIndex: 4, reason: expect.stringContaining('name') })
    )
  })

  it('exposes the SDK rejection this workaround must continue to account for', async () => {
    result = { tools: validTools }
    await expect(client.listTools()).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ['tools', 1, 'outputSchema', 'properties', 'canonical_state'], code: 'custom' })
      ])
    })
  })

  it.each([true, false])('preserves output validation for the boolean subschema %s', async (value) => {
    await listToolsTolerant(client)
    await expect(client.callTool({ name: `state-${value}`, arguments: {} })).rejects.toThrow(
      /has an output schema but did not return structured content/
    )
  })

  it('still rejects a malformed tools/list envelope', async () => {
    result = { tools: 'not an array' }
    await expect(listToolsTolerant(client)).rejects.toThrow()
  })
})
