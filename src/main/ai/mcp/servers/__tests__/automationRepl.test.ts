import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { Emitter } from '@main/core/lifecycle'

import { createAutomationReplServer } from '../automationRepl'

describe.each(['modern', 'legacy'] as const)('Automation MCP output (%s)', (era) => {
  const dbh = setupTestDatabase()
  let client: Client
  let server: McpServer
  let handle: StdioServerHandle
  let output: CallToolResult
  let terminal: Emitter<never>
  let idle: Emitter<never>

  beforeEach(async () => {
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/test/workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', workspaceId: 'workspace', name: 'Task', orderKey: 'a0' })
      .run()
    terminal = new Emitter()
    idle = new Emitter()
    const get = application.getContainer().get.bind(application.getContainer())
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'AutomationReplService')
        return {
          beginRun: () => ({ execute: async () => output, reset: async () => output, finish: async () => {} }),
          close: async () => {}
        }
      if (name === 'AgentSessionRuntimeService')
        return { getLiveAssistantMessageId: () => 'message', onTurnTerminal: terminal.event, onRuntimeIdle: idle.event }
      return get(name as Parameters<typeof get>[0])
    }) as typeof application.get)
    server = createAutomationReplServer('session', 'agent')
    client = new Client(
      { name: 'test', version: '1.0.0' },
      { versionNegotiation: { mode: era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } } }
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    handle = serveStdio(() => server, { transport: serverTransport })
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await server?.close()
    await client?.close()
    await handle?.close()
    terminal?.dispose()
    idle?.dispose()
    vi.restoreAllMocks()
  })

  it.each([false, true])(
    'preserves observation text and images without metadata shadowing (isError=%s)',
    async (isError) => {
      output = {
        content: [
          { type: 'text', text: '# Computer automation\nUse app.getAXState() to observe.' },
          { type: 'text', text: 'OBSERVATION calculator-1\nAXStaticText value="635.125"' },
          { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png', annotations: { audience: ['assistant'] } },
          { type: 'text', text: 'REPL_CONTEXT {"state":"retained"}', annotations: { audience: ['assistant'] } },
          { type: 'text', text: 'EXECUTION {"events":[]}', annotations: { audience: ['assistant'] } }
        ],
        structuredContent: { replContext: { state: 'retained' }, execution: { events: [] } },
        isError
      }
      const result = await client.callTool({ name: 'js', arguments: { code: 'await app.getAXState()' } })

      expect(result.content).toEqual(output.content)
      expect(result.isError).toBe(isError)
      expect(result.structuredContent).toBeUndefined()
      expect(output.structuredContent).toEqual({ replContext: { state: 'retained' }, execution: { events: [] } })
    }
  )

  it('delivers reset feedback without structured metadata replacing the text', async () => {
    output = {
      content: [
        { type: 'text', text: 'Automation REPL reset.' },
        { type: 'text', text: 'REPL_CONTEXT {"state":"cleared"}', annotations: { audience: ['assistant'] } }
      ],
      structuredContent: { replContext: { state: 'cleared' } }
    }
    const result = await client.callTool({ name: 'reset', arguments: {} })

    expect(result.content).toEqual(output.content)
    expect(result.structuredContent).toBeUndefined()
    expect(result.isError).not.toBe(true)
  })
})
