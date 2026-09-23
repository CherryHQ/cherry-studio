import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { acceptedContent, inputRequired, Server } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
      const server = new Server({ name: 'elicitation-test', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler('tools/list', async () => ({
        tools: [
          {
            name: 'confirm',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id']
            }
          }
        ]
      }))
      server.setRequestHandler('tools/call', async (request, context) => {
        const id = String(request.params.arguments?.id)
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

  it('keeps memory state across independent createMcpHandler.fetch requests', async () => {
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
        const server = new Server({ name: 'pagination-test', version: '1.0.0' }, { capabilities: { tools: {} } })
        server.setRequestHandler('tools/list', async (request) =>
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
      const server = new Server({ name: 'round-limit-test', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler('tools/list', async () => ({
        tools: [{ name: 'never_done', inputSchema: { type: 'object', properties: {} } }]
      }))
      server.setRequestHandler('tools/call', async () =>
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
})
