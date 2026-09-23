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

const uncompilableTool = {
  name: 'uncompilable',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object', properties: { x: { type: 'bogus' } } }
}

describe('listToolsTolerant', () => {
  let client: Client
  let server: McpServer
  let result: { tools?: unknown; nextCursor?: unknown }

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

  it.each([
    ['name', { name: 123 }],
    ['title', { title: 123 }],
    ['description', { description: 123 }],
    ['annotations', { annotations: 'invalid' }],
    ['annotations.title', { annotations: { title: 123 } }],
    ['annotations.readOnlyHint', { annotations: { readOnlyHint: 'true' } }],
    ['execution', { execution: 'invalid' }],
    ['execution.taskSupport', { execution: { taskSupport: 'invalid' } }],
    ['icons', { icons: [{ src: 123 }] }],
    ['_meta', { _meta: 'invalid' }],
    ['icons.mimeType', { icons: [{ src: 'icon.png', mimeType: 123 }] }],
    ['icons.sizes', { icons: [{ src: 'icon.png', sizes: [123] }] }]
  ])('skips a malformed %s while retaining healthy peers', async (field, invalidFields) => {
    result = { tools: [...validTools, { name: 'invalid', inputSchema: { type: 'object' }, ...invalidFields }] }

    await expect(listToolsTolerant(client)).resolves.toEqual(validTools)
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Skipping invalid MCP tool',
      expect.objectContaining({ toolIndex: validTools.length, reason: expect.stringContaining(field.split('.')[0]) })
    )
  })

  it('retains SDK-valid metadata and nested protocol extensions', async () => {
    const tool = {
      name: '',
      title: 'Display name',
      description: 'Description',
      inputSchema: { type: 'object', properties: { value: {} }, required: ['value'], extension: true },
      annotations: { title: 'Annotation title', readOnlyHint: true, extension: 'preserved' },
      execution: { taskSupport: 'optional', extension: 'preserved' },
      icons: [{ src: 'icon.png', mimeType: 'image/png', sizes: ['48x48'], theme: 'dark', extension: true }],
      _meta: { extension: 'preserved' },
      extension: true
    }
    result = { tools: [tool] }

    await expect(client.listTools()).resolves.toMatchObject({ tools: [{ name: '' }] })
    await expect(listToolsTolerant(client)).resolves.toEqual([tool])
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
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

  it.each([{}, { tools: null }])('rejects missing or null tools: %j', async (envelope) => {
    result = envelope
    await expect(listToolsTolerant(client)).rejects.toThrow()
  })

  it('rejects a non-string pagination cursor', async () => {
    result = { tools: validTools, nextCursor: 123 }
    await expect(listToolsTolerant(client)).rejects.toThrow(/nextCursor/)
  })

  it('retains all accepted tools when metadata caching is unsupported', async () => {
    result = { tools: validTools }
    const requestOnlyClient = { request: client.request.bind(client) } as unknown as Client

    await expect(listToolsTolerant(requestOnlyClient)).resolves.toEqual(validTools)
    expect(mockMainLoggerService.warn).toHaveBeenCalledExactlyOnceWith(
      'MCP tool metadata caching is unsupported; retaining accepted tools',
      expect.objectContaining({ reason: expect.stringContaining('cacheToolMetadata') })
    )
  })

  it('resolves with valid tools and rebuilds their metadata after skipping an uncompilable output schema', async () => {
    const taskTool = { name: 'task', inputSchema: { type: 'object' }, execution: { taskSupport: 'required' } }
    const retainedTools = [taskTool, ...validTools]
    result = { tools: [taskTool, uncompilableTool, ...validTools] }

    await expect(listToolsTolerant(client)).resolves.toEqual(retainedTools)
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Skipping invalid MCP tool',
      expect.objectContaining({ toolName: 'uncompilable', reason: expect.stringContaining('bogus') })
    )
    for (const value of [true, false]) {
      await expect(client.callTool({ name: `state-${value}`, arguments: {} })).rejects.toThrow(
        /has an output schema but did not return structured content/
      )
    }
    await expect(client.callTool({ name: 'task', arguments: {} })).rejects.toThrow(/requires task-based execution/)
  })

  it('resolves with no tools when every output schema is uncompilable', async () => {
    result = { tools: [uncompilableTool, { ...uncompilableTool, name: 'also-uncompilable' }] }

    await expect(listToolsTolerant(client)).resolves.toEqual([])
    for (const toolName of ['uncompilable', 'also-uncompilable']) {
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Skipping invalid MCP tool',
        expect.objectContaining({ toolName, reason: expect.stringContaining('bogus') })
      )
    }
  })

  it('returns healthy tools unchanged without warnings', async () => {
    result = { tools: validTools }

    await expect(listToolsTolerant(client)).resolves.toEqual(validTools)
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })
})
