import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { acceptedContent, inputRequired, Server } from '@modelcontextprotocol/server'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BuiltinMcpEndpoint } from '../../servers/factory'
import { createBuiltinMcpEndpoint } from '../../servers/factory'
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

  it('keeps memory state across independent createMcpHandler.fetch requests', async () => {
    const endpoint = createBuiltinMcpEndpoint(BuiltinMcpServerNames.memory, [], {
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

  it('keeps sequential-thinking history across handler requests', async () => {
    const endpoint = createBuiltinMcpEndpoint(BuiltinMcpServerNames.sequentialThinking)
    const closeEndpoint = vi.spyOn(endpoint, 'close')
    const connection = await createInProcessMcpConnection({
      appVersion: 'test',
      endpoint,
      events,
      connectTimeoutMs: 10_000
    })

    await connection.callTool(
      'sequentialthinking',
      { thought: 'first', thoughtNumber: 1, totalThoughts: 2, nextThoughtNeeded: true },
      callOptions()
    )
    const second = await connection.callTool(
      'sequentialthinking',
      { thought: 'second', thoughtNumber: 2, totalThoughts: 2, nextThoughtNeeded: false },
      callOptions()
    )

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
      /no active window\/topic interaction context/
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
    await connection.close()
  })
})
