import '@data/services/AgentGlobalSkillService'
import { randomUUID } from 'node:crypto'

import type { Client } from '@modelcontextprotocol/client'
import { setupTestDatabase } from '@test-helpers/db'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'

import { createMcpManagerServer } from '../mcpManager'

describe('mcp manager integration', () => {
  const dbh = setupTestDatabase()
  const clients: Client[] = []
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    vi.useRealTimers()
  })

  it('persists one shared definition for identical installs by two agents and an agent retry', async () => {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'anthropic', name: 'anthropic', orderKey: generateOrderKeyBetween(null, null) })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'anthropic::claude-3-5-sonnet',
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        name: 'claude-3-5-sonnet',
        capabilities: [],
        supportsStreaming: true,
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
    const other = mcpServerService.create({ name: 'other', command: 'other', isActive: false })
    const a = agentService.createAgentWithId(randomUUID(), {
      type: 'claude-code',
      name: 'A',
      model: 'anthropic::claude-3-5-sonnet',
      mcps: []
    })
    const b = agentService.createAgentWithId(randomUUID(), {
      type: 'claude-code',
      name: 'B',
      model: 'anthropic::claude-3-5-sonnet',
      mcps: [other.id]
    })
    const clientA = await connectMcpTestClient(() => createMcpManagerServer(a.id))
    const clientB = await connectMcpTestClient(() => createMcpManagerServer(b.id))
    clients.push(clientA, clientB)
    const args = {
      name: 'shared',
      type: 'stdio',
      command: 'npx',
      args: ['server'],
      env: { API_KEY: 'first' },
      activate: false
    }
    const call = (client: Client, input: typeof args) =>
      client.callTool({ name: 'install_mcp_server', arguments: input })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    const first = await call(clientA, args)
    const initial = dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, 'shared')).all()[0]
    vi.setSystemTime(new Date('2025-01-02T00:00:00Z'))
    const second = await call(clientB, args)
    const third = await call(clientB, args)
    expect([first.isError, second.isError, third.isError]).toEqual([undefined, undefined, undefined])
    const rows = dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, 'shared')).all()
    expect(rows).toHaveLength(1)
    expect(dbh.db.select().from(mcpServerTable).all()).toHaveLength(2)
    for (const result of [first, second, third]) expect(JSON.stringify(result.content)).toContain(initial.id)
    expect(JSON.stringify(second.content)).toContain('reused and registered')
    expect(JSON.stringify(third.content)).toContain('already registered')
    expect(rows[0]).toMatchObject({
      id: initial.id,
      installedAt: initial.installedAt,
      installSource: 'ai_assisted',
      isActive: false,
      isTrusted: false
    })
    const links = dbh.db.select().from(agentMcpServerTable).all()
    expect(links.filter((link) => link.agentId === a.id && link.mcpServerId === initial.id)).toHaveLength(1)
    expect(links.filter((link) => link.agentId === b.id && link.mcpServerId === initial.id)).toHaveLength(1)
    expect(links.filter((link) => link.agentId === b.id && link.mcpServerId === other.id)).toHaveLength(1)
    expect(agentService.getAgent(a.id)?.mcps).toEqual([initial.id])
    expect(agentService.getAgent(b.id)?.mcps).toEqual(expect.arrayContaining([other.id, initial.id]))
    const different = await call(clientB, { ...args, env: { API_KEY: 'second' } })
    expect(different.isError).toBeFalsy()
    const both = dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, 'shared')).all()
    expect(both).toHaveLength(2)
    const added = both.find((row) => row.id !== initial.id)!
    expect(added.env).toEqual({ API_KEY: 'second' })
    expect(both.find((row) => row.id === initial.id)?.env).toEqual({ API_KEY: 'first' })
    expect(agentService.getAgent(a.id)?.mcps).toEqual([initial.id])
    expect(agentService.getAgent(b.id)?.mcps).toHaveLength(3)
    expect(agentService.getAgent(b.id)?.mcps).toEqual(expect.arrayContaining([other.id, initial.id, added.id]))
    const finalLinks = dbh.db.select().from(agentMcpServerTable).all()
    expect(finalLinks.filter((link) => link.agentId === a.id && link.mcpServerId === initial.id)).toHaveLength(1)
    expect(finalLinks.filter((link) => link.agentId === b.id && link.mcpServerId === initial.id)).toHaveLength(1)
    expect(finalLinks.filter((link) => link.agentId === b.id && link.mcpServerId === added.id)).toHaveLength(1)
    expect(finalLinks.filter((link) => link.agentId === b.id && link.mcpServerId === other.id)).toHaveLength(1)
  })
})
