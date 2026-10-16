import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  type ServerCapabilities,
  UnauthorizedError
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { acceptedContent, inputRequired, McpServer } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import type { BuiltinMcpEndpoint } from '../../servers/factory'
import { createBuiltinMcpEndpoint } from '../../servers/factory'
import { ClientMcpConnection } from '../ClientMcpConnection'
import { createInProcessMcpConnection } from '../InProcessMcpConnection'
import type { McpCallToolOptions, McpConnectionEvents } from '../McpConnection'

const events: McpConnectionEvents = {
  toolsChanged: vi.fn(),
  promptsChanged: vi.fn(),
  resourcesChanged: vi.fn(),
  resourceUpdated: vi.fn(),
  log: vi.fn()
}

function callOptions(): McpCallToolOptions {
  return {
    signal: new AbortController().signal,
    timeoutMs: 10_000
  }
}

function createElicitationEndpoint(): BuiltinMcpEndpoint {
  return {
    createServer: () => {
      const server = new McpServer({ name: 'elicitation-test', version: '1.0.0' })
      server.registerTool('confirm', { inputSchema: z.object({ id: z.string() }) }, async ({ id }, context) => {
        const accepted = acceptedContent<{ approved: boolean }>(context.mcpReq.inputResponses, 'confirm')
        if (!accepted?.approved) {
          return inputRequired({
            inputRequests: {
              confirm: inputRequired.elicit({
                message: `Approve ${id}`,
                requestedSchema: {
                  type: 'object',
                  properties: { approved: { type: 'boolean' } },
                  required: ['approved']
                }
              })
            }
          })
        }
        return { content: [{ type: 'text', text: `approved:${id}` }] }
      })
      return server
    },
    close: async () => undefined
  }
}

describe('modern in-process MCP wire', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-modern-mcp-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it.each([false, true])('keeps a legacy stdio session usable when ping is unsupported: %s', async (rejectPing) => {
    const entry = path.join(tempDir, 'legacy.cjs')
    await fs.writeFile(
      entry,
      `
const methods = [];
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  methods.push(request.method);
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'legacy', version: '1' } };
  else if (request.method === 'ping' && !${rejectPing}) result = {};
  else if (request.method === 'tools/list') result = { tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] };
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, methods, calls: methods.filter(m => m === 'tools/call').length }) }] };
  const response = result === undefined ? { error: { code: -32601, message: 'Method not found' } } : { result };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }) + '\\n');
});
`
    )
    const connection = new ClientMcpConnection(
      { name: 'test', version: '1' },
      {
        capabilities: { elicitation: { form: {} }, sampling: {}, roots: {} },
        versionNegotiation: { mode: 'auto', probe: { timeoutMs: 1_000, maxRetries: 0 } }
      },
      events
    )
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe' })
    try {
      await connection.connect(transport)
      expect(connection.era).toBe('legacy')
      const pid = transport.pid
      expect(pid).not.toBeNull()
      for (let pass = 0; pass < 2; pass++) {
        await connection.health()
        await expect(connection.listTools('refresh')).resolves.toMatchObject([{ name: 'inspect' }])
        const result = await connection.callTool('inspect', {}, callOptions())
        const part = result.content[0]
        if (part.type !== 'text') throw new Error('Expected inspection text')
        const state = JSON.parse(part.text)
        expect(state.pid).toBe(pid)
        expect(state.calls).toBe(pass + 1)
        expect(state.methods).not.toContain('server/discover')
        expect(state.methods.filter((method: string) => method === 'ping')).toHaveLength(rejectPing ? 1 : pass + 1)
      }
    } finally {
      await connection.close()
    }
    expect(transport.pid).toBeNull()
  })

  it('routes interleaved tools, prompts and resources over a real stdio child to their own hosts', async () => {
    const require = createRequire(import.meta.url)
    const entry = path.join(tempDir, 'server.cjs')
    await fs.writeFile(
      entry,
      `
const { Server, inputRequired, acceptedContent } = require(${JSON.stringify(require.resolve('@modelcontextprotocol/server'))});
const { serveStdio } = require(${JSON.stringify(require.resolve('@modelcontextprotocol/server/stdio'))});
serveStdio(() => {
  const server = new Server({ name: 'stdio-interactions', version: '1' }, { capabilities: { tools: {}, prompts: {}, resources: {} } });
  server.setRequestHandler('tools/list', async () => ({ tools: [{ name: 'confirm', inputSchema: { type: 'object' }, outputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }, { name: 'forbidden', inputSchema: { type: 'object' }, outputSchema: { not: {} } }] }));
  for (const method of ['tools/call', 'prompts/get', 'resources/read']) server.setRequestHandler(method, async (request, context) => {
    if (request.params.name === 'forbidden') return { content: [], structuredContent: null };
    const id = request.params.arguments?.id ?? request.params.uri;
    const value = acceptedContent(context.mcpReq.inputResponses, 'answer');
    if (!value) return inputRequired({ requestState: 'opaque:' + id, inputRequests: { answer: inputRequired.elicit({ message: id, requestedSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }) } });
    if (value.id !== id || context.mcpReq.requestState() !== 'opaque:' + id) throw new Error('Crossed interaction contexts');
    if (method === 'tools/call') return { content: [], structuredContent: { id } };
    if (method === 'prompts/get') return { messages: [{ role: 'user', content: { type: 'text', text: id } }] };
    return { contents: [{ uri: id, text: id }] };
  });
  return server;
});
`
    )
    const connection = new ClientMcpConnection(
      { name: 'test', version: '1' },
      {
        capabilities: { elicitation: { form: {} }, sampling: {}, roots: {} },
        versionNegotiation: { mode: { pin: '2026-07-28' } }
      },
      events
    )
    await connection.connect(new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe' }))
    const options = (id: string): McpCallToolOptions => ({
      ...callOptions(),
      interactionContext: {
        windowId: id,
        topicId: id,
        requestElicitation: async (request) => {
          expect(request.params.message).toBe(id)
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { action: 'accept', content: { id } }
        }
      }
    })
    try {
      const [tool, prompt, resource] = await Promise.all([
        connection.callTool('confirm', { id: 'tool' }, options('tool')),
        connection.getPrompt('confirm', { id: 'prompt' }, options('prompt')),
        connection.readResource('resource://one', 'refresh', options('resource://one'))
      ])
      expect(tool.structuredContent).toEqual({ id: 'tool' })
      expect(prompt.messages[0].content).toMatchObject({ text: 'prompt' })
      expect(resource.contents[0]).toMatchObject({ text: 'resource://one' })
      const forwarded = await connection.forwardRequest(
        'tools/call',
        { name: 'confirm', arguments: { id: 'proxy' } },
        {
          ...callOptions(),
          capabilities: { elicitation: { form: {} } }
        }
      )
      expect(forwarded).toMatchObject({ resultType: 'input_required', requestState: 'opaque:proxy' })
      const completed = await connection.forwardRequest(
        'tools/call',
        {
          name: 'confirm',
          arguments: { id: 'proxy' },
          requestState: 'opaque:proxy',
          inputResponses: { answer: { action: 'accept', content: { id: 'proxy' } } }
        },
        { ...callOptions(), capabilities: { elicitation: { form: {} } } }
      )
      expect(completed).toMatchObject({ structuredContent: { id: 'proxy' } })
      await expect(connection.callTool('forbidden', {}, callOptions())).rejects.toThrow(/output/i)
      await expect(
        connection.forwardRequest('tools/call', { name: 'forbidden' }, { ...callOptions(), capabilities: {} })
      ).rejects.toThrow()
    } finally {
      await connection.close()
    }
  })

  it('keeps memory state across calls on one in-process connection', async () => {
    const endpoint = await createBuiltinMcpEndpoint(BuiltinMcpServerNames.memory, [], {
      MEMORY_FILE_PATH: path.join(tempDir, 'memory.jsonl')
    })
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      endpoint,
      events,
      connectTimeoutMs: 10_000
    })

    expect(connection.era).toBe('modern')
    await expect(connection.listTools('refresh')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'create_entities' })])
    )

    await connection.callTool(
      'create_entities',
      {
        entities: [{ name: 'Cherry', entityType: 'application', observations: ['stateful'] }]
      },
      callOptions()
    )
    const graph = await connection.callTool('read_graph', {}, callOptions())

    expect(graph.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('"name": "Cherry"')
        })
      ])
    )
    await connection.close()
  })

  it('lets the v2 client aggregate paginated tool lists', async () => {
    const endpoint: BuiltinMcpEndpoint = {
      createServer: () => {
        const server = new McpServer({ name: 'pagination-test', version: '1.0.0' }, { capabilities: { tools: {} } })
        // McpServer never paginates its own registry, so page through the underlying protocol server.
        server.server.setRequestHandler('tools/list', async (request) =>
          request.params?.cursor
            ? {
                tools: [{ name: 'second', inputSchema: { type: 'object', properties: {} } }]
              }
            : {
                tools: [{ name: 'first', inputSchema: { type: 'object', properties: {} } }],
                nextCursor: 'page-2'
              }
        )
        return server
      },
      close: async () => undefined
    }
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      endpoint,
      events,
      connectTimeoutMs: 10_000
    })

    await expect(connection.listTools('refresh')).resolves.toEqual([
      expect.objectContaining({ name: 'first' }),
      expect.objectContaining({ name: 'second' })
    ])
    await connection.close()
  })

  it('isolates interleaved thinking chains and releases completed chains', async () => {
    const endpoint = await createBuiltinMcpEndpoint(BuiltinMcpServerNames.sequentialThinking)
    const closeEndpoint = vi.spyOn(endpoint, 'close')
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      endpoint,
      events,
      connectTimeoutMs: 10_000
    })

    const first = await connection.callTool(
      'sequentialthinking',
      { thought: 'first', thoughtNumber: 1, totalThoughts: 2, nextThoughtNeeded: true },
      callOptions()
    )
    const chainId = JSON.parse((first.content[0] as { text: string }).text).chainId
    const unrelated = await connection.callTool(
      'sequentialthinking',
      {
        thought: 'unrelated',
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        branchFromThought: 1,
        branchId: 'other'
      },
      callOptions()
    )
    expect(JSON.parse((unrelated.content[0] as { text: string }).text).thoughtHistoryLength).toBe(1)
    const second = await connection.callTool(
      'sequentialthinking',
      { chainId, thought: 'second', thoughtNumber: 2, totalThoughts: 2, nextThoughtNeeded: false },
      callOptions()
    )
    expect(JSON.parse((second.content[0] as { text: string }).text).branches).toEqual([])
    const stale = await connection.callTool(
      'sequentialthinking',
      { chainId, thought: 'stale', thoughtNumber: 3, totalThoughts: 3, nextThoughtNeeded: false },
      callOptions()
    )
    expect(stale.isError).toBe(true)

    expect(second.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('"thoughtHistoryLength": 2')
        })
      ])
    )
    await connection.close()
    await connection.close()
    expect(closeEndpoint).toHaveBeenCalledOnce()
  })

  it('auto-fulfills embedded requests and isolates concurrent interaction contexts', async () => {
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      endpoint: createElicitationEndpoint(),
      events,
      connectTimeoutMs: 10_000
    })
    const authorizeA = vi.fn(async (request: unknown) => {
      expect(request).toMatchObject({ params: { message: 'Approve A' } })
      await Promise.resolve()
      return { action: 'accept' as const, content: { approved: true } }
    })
    const authorizeB = vi.fn(async (request: unknown) => {
      expect(request).toMatchObject({ params: { message: 'Approve B' } })
      await Promise.resolve()
      return { action: 'accept' as const, content: { approved: true } }
    })

    const [resultA, resultB] = await Promise.all([
      connection.callTool(
        'confirm',
        { id: 'A' },
        {
          ...callOptions(),
          interactionContext: {
            windowId: 'window-a',
            topicId: 'topic-a',
            requestElicitation: authorizeA
          }
        }
      ),
      connection.callTool(
        'confirm',
        { id: 'B' },
        {
          ...callOptions(),
          interactionContext: {
            windowId: 'window-b',
            topicId: 'topic-b',
            requestElicitation: authorizeB
          }
        }
      )
    ])

    expect(authorizeA).toHaveBeenCalledOnce()
    expect(authorizeB).toHaveBeenCalledOnce()
    expect(resultA.content).toContainEqual(expect.objectContaining({ text: 'approved:A' }))
    expect(resultB.content).toContainEqual(expect.objectContaining({ text: 'approved:B' }))
    await connection.close()
  })

  it('rejects embedded requests when the tool call has no active interaction context', async () => {
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      endpoint: createElicitationEndpoint(),
      events,
      connectTimeoutMs: 10_000
    })

    await expect(connection.callTool('confirm', { id: 'headless' }, callOptions())).rejects.toThrow(
      /client capabilities do not declare the required capability/
    )
    await connection.close()
  })

  it('stops an embedded-request flow at the configured ten-round limit', async () => {
    const createServer = () => {
      const server = new McpServer({ name: 'round-limit-test', version: '1.0.0' })
      server.registerTool('never_done', {}, async () =>
        inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: 'Confirm again',
              requestedSchema: {
                type: 'object',
                properties: { approved: { type: 'boolean' } },
                required: ['approved']
              }
            })
          }
        })
      )
      return server
    }
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      endpoint: { createServer, close: async () => undefined },
      events,
      connectTimeoutMs: 10_000
    })
    const requestElicitation = vi.fn(async () => ({
      action: 'accept' as const,
      content: { approved: true }
    }))

    await expect(
      connection.callTool(
        'never_done',
        {},
        {
          ...callOptions(),
          interactionContext: {
            windowId: 'window',
            topicId: 'topic',
            requestElicitation
          }
        }
      )
    ).rejects.toThrow(/10 rounds/)
    expect(requestElicitation).toHaveBeenCalledTimes(10)
    await expect(
      connection.callTool(
        'never_done',
        {},
        {
          ...callOptions(),
          maxTotalTimeoutMs: 30,
          interactionContext: {
            requestElicitation: (_request, signal) =>
              new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true })
              })
          }
        }
      )
    ).rejects.toThrow(/timeout/i)
    await connection.close()
  })
})

describe('ClientMcpConnection health checks', () => {
  const healthConnection = (era: 'modern' | 'legacy' = 'legacy', capabilities: ServerCapabilities = { tools: {} }) => {
    const connection = new ClientMcpConnection(
      { name: 'test', version: '1' },
      { capabilities: { elicitation: { form: {} }, sampling: {}, roots: {} } },
      events
    )
    const client = (connection as any).client
    vi.spyOn(client, 'getProtocolEra').mockReturnValue(era)
    vi.spyOn(client, 'getServerCapabilities').mockReturnValue(capabilities)
    vi.spyOn(client, 'transport', 'get').mockReturnValue({})
    return { connection, client }
  }
  it.each([
    { era: 'modern' as const, expected: 'discover', skipped: 'ping' },
    { era: 'legacy' as const, expected: 'ping', skipped: 'discover' }
  ])('bounds $era health checks', async ({ era, expected, skipped }) => {
    const connection = new ClientMcpConnection(
      { name: 'test', version: '1' },
      {
        capabilities: { elicitation: { form: {} }, sampling: {}, roots: {} },
        versionNegotiation: { mode: 'auto' }
      },
      events
    )
    const client = (connection as any).client
    vi.spyOn(client, 'getProtocolEra').mockReturnValue(era)
    const health = vi.spyOn(client, expected).mockResolvedValue(undefined)
    const other = vi.spyOn(client, skipped).mockResolvedValue(undefined)

    await connection.health()

    expect(health).toHaveBeenCalledWith({ timeout: 5_000 })
    expect(other).not.toHaveBeenCalled()
  })

  it.each([
    {
      era: 'legacy',
      error: new ProtocolError(ProtocolErrorCode.MethodNotFound, 'unsupported'),
      capabilities: { tools: {}, prompts: {}, resources: {} },
      method: 'listTools',
      result: { tools: [] }
    },
    {
      era: 'legacy',
      error: new SdkError(SdkErrorCode.RequestTimeout, 'timeout'),
      capabilities: { prompts: {}, resources: {} },
      method: 'listPrompts',
      result: { prompts: [] }
    },
    {
      era: 'modern',
      error: new SdkError(SdkErrorCode.MethodNotSupportedByProtocolVersion, 'unsupported'),
      capabilities: { resources: {} },
      method: 'listResources',
      result: { resources: [] }
    }
  ] as const)(
    'confirms $era liveness with fresh $method and retains the working method',
    async ({ era, error, capabilities, method, result }) => {
      const { connection, client } = healthConnection(era, capabilities)
      const primary = vi.spyOn(client, era === 'legacy' ? 'ping' : 'discover').mockRejectedValue(error)
      const other = vi.spyOn(client, era === 'legacy' ? 'discover' : 'ping')
      const confirm = vi.spyOn(client, method).mockResolvedValue(result)
      await expect(connection.health()).resolves.toBeUndefined()
      await expect(connection.health()).resolves.toBeUndefined()
      expect(primary).toHaveBeenCalledTimes(1)
      expect(other).not.toHaveBeenCalled()
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(confirm).toHaveBeenCalledWith(expect.any(Object), {
        cacheMode: 'refresh',
        timeout: 5_000,
        signal: expect.any(AbortSignal)
      })
    }
  )

  it.each([
    { error: new UnauthorizedError(), connected: true, capabilities: { tools: {} } },
    { error: new SdkError(SdkErrorCode.ConnectionClosed, 'closed'), connected: true, capabilities: { tools: {} } },
    { error: new SdkError(SdkErrorCode.RequestTimeout, 'timeout'), connected: false, capabilities: { tools: {} } },
    { error: new ProtocolError(ProtocolErrorCode.MethodNotFound, 'unsupported'), connected: true, capabilities: {} }
  ])('does not bypass an unconfirmable health failure: $error', async ({ error, connected, capabilities }) => {
    const { connection, client } = healthConnection('legacy', capabilities)
    vi.spyOn(client, 'transport', 'get').mockReturnValue(connected ? {} : undefined)
    vi.spyOn(client, 'ping').mockRejectedValue(error)
    const confirm = vi.spyOn(client, 'listTools').mockResolvedValue({ tools: [] })
    await expect(connection.health()).rejects.toBe(error)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('reports a failed fresh confirmation instead of accepting cached tools', async () => {
    const { connection, client } = healthConnection()
    vi.spyOn(client, 'ping').mockRejectedValue(new ProtocolError(ProtocolErrorCode.MethodNotFound, 'unsupported'))
    const failure = new SdkError(SdkErrorCode.RequestTimeout, 'catalog timeout')
    const confirm = vi
      .spyOn(client, 'listTools')
      .mockImplementation((_params, options) =>
        (options as { cacheMode: string }).cacheMode === 'refresh'
          ? Promise.reject(failure)
          : Promise.resolve({ tools: [{ name: 'cached' }] })
      )
    await expect(connection.health()).rejects.toBe(failure)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
