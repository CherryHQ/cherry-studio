import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { ComputerUse } from '@cherrystudio/computer-use'
import type * as ComputerUseModule from '@cherrystudio/computer-use'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelSessionTable, agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { ComputerUseService } from '@main/services/ComputerUseService'

import { createComputerUseMcpServer } from '../computerUse'

vi.mock('@cherrystudio/computer-use', async (original) => ({
  ...(await original<typeof ComputerUseModule>()),
  ComputerUse: { start: vi.fn() }
}))

describe.each(['modern', 'legacy'] as const)('Agent Computer Use adapter (%s)', (era) => {
  const dbh = setupTestDatabase()
  let server: McpServer
  let client: Client
  let handle: StdioServerHandle
  let service: ComputerUseService
  let messageId: string | undefined
  let terminal: Emitter<{ sessionId: string; assistantMessageId: string }>
  let idle: Emitter<{ sessionId: string }>
  let events: string[]

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', true)
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/test/workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', workspaceId: 'workspace', name: 'Task', orderKey: 'a0' })
      .run()
    service = new ComputerUseService()
    messageId = 'message-1'
    terminal = new Emitter()
    idle = new Emitter()
    events = []
    const runtime = {
      getLiveAssistantMessageId: () => messageId,
      onTurnTerminal: terminal.event,
      onRuntimeIdle: idle.event
    }
    const get = application.getContainer().get.bind(application.getContainer())
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'ComputerUseService') return service
      if (name === 'AgentSessionRuntimeService') return runtime
      return get(name as Parameters<typeof get>[0])
    }) as typeof application.get)
    let runtimeId = 0
    vi.mocked(ComputerUse.start).mockImplementation(async () => {
      const id = ++runtimeId
      return {
        getCapabilities: vi.fn(),
        getPermissionStatus: vi.fn(),
        requestPermissions: vi.fn(),
        listApps: vi.fn(),
        listAppSessions: vi.fn(),
        stopAppSession: vi.fn(),
        getAppState: vi.fn(),
        act: vi.fn(),
        onClosed: () => () => {},
        openAppSession: async ({ appId }) => {
          events.push(`open:${id}`)
          return { id: `app-session-${id}`, app: { id: appId, name: appId }, status: 'active' }
        },
        close: async () => {
          events.push(`close:${id}`)
        }
      }
    })
    server = createComputerUseMcpServer('session', 'agent')
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
    terminal.dispose()
    idle.dispose()
    vi.restoreAllMocks()
  })

  const openApp = () => client.callTool({ name: 'open_app', arguments: { appId: 'editor' } })

  it('closes the completed turn while the Agent connection stays warm and preserves user stop across turns', async () => {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'list_apps',
      'open_app',
      'get_app_state',
      'click',
      'perform_secondary_action',
      'scroll',
      'drag',
      'type_text',
      'press_key',
      'set_value'
    ])
    expect(await openApp()).toMatchObject({ content: [{ text: expect.stringContaining('"id":"app-session-1"') }] })
    messageId = undefined
    terminal.fire({ sessionId: 'session', assistantMessageId: 'message-1' })
    await vi.waitFor(() => expect(events).toEqual(['open:1', 'close:1']))
    expect(await openApp()).toHaveProperty('isError', true)
    messageId = 'message-2'
    expect(await openApp()).not.toHaveProperty('isError', true)
    await service.stopAll()
    messageId = 'message-3'
    const stopped = await openApp()
    expect(stopped).toHaveProperty('isError', true)
    expect(JSON.stringify(stopped)).toContain('USER_STOPPED')
    expect(events).toEqual(['open:1', 'close:1', 'open:2', 'close:2'])
  })

  it('rechecks live Agent opt-out and channel binding even on an existing connection', async () => {
    dbh.db
      .update(agentTable)
      .set({ disabledTools: ['mcp__computer'] })
      .where(eq(agentTable.id, 'agent'))
      .run()
    expect(await openApp()).toHaveProperty('isError', true)
    dbh.db.update(agentTable).set({ disabledTools: [] }).where(eq(agentTable.id, 'agent')).run()
    dbh.db
      .insert(agentChannelTable)
      .values({
        id: 'channel',
        name: 'Channel',
        type: 'telegram',
        agentId: 'agent',
        workspace: { type: 'system' },
        config: {}
      })
      .run()
    dbh.db.insert(agentChannelSessionTable).values({ channelId: 'channel', sessionId: 'session' }).run()
    expect(await openApp()).toHaveProperty('isError', true)
    expect(events).toEqual([])
  })

  it('releases resources on runtime idle without a terminal event', async () => {
    await openApp()
    messageId = undefined
    idle.fire({ sessionId: 'session' })
    await vi.waitFor(() => expect(events).toEqual(['open:1', 'close:1']))
    expect(service.getControls()).toEqual([])
  })

  it('releases the active task when the Agent transport disconnects', async () => {
    await openApp()
    await client.close()
    await vi.waitFor(() => expect(events).toEqual(['open:1', 'close:1']))
    expect(service.getControls()).toEqual([])
  })
})
