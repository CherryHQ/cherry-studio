import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantHandlers } from '@data/api/handlers/assistants'
import { assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { assistantDataService } from '@data/services/AssistantService'
import { mcpServerService } from '@data/services/McpServerService'
import { BaseService } from '@main/core/lifecycle'

import { McpCatalogService } from '../McpCatalogService'
import { McpRuntimeService } from '../McpRuntimeService'

const connectionFactory = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../connections/ExternalMcpConnection', () => ({
  createExternalMcpConnection: connectionFactory.create
}))

function connection() {
  return {
    era: 'modern',
    serverVersion: '1.0.0',
    health: vi.fn(async () => {}),
    listTools: vi.fn(async () => [{ name: 'read_file', inputSchema: { type: 'object', properties: {} } }]),
    close: vi.fn(async () => {})
  }
}

describe('Assistant arming survives MCP connection failure and recovery', () => {
  const dbh = setupTestDatabase()
  let runtime: McpRuntimeService

  beforeEach(() => {
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    connectionFactory.create.mockReset()
    runtime = new McpRuntimeService()
    MockApplicationUtils.setService('McpRuntimeService', runtime)
  })

  afterEach(async () => {
    await runtime._doStop()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
  })

  it('preserves rows through real health failures, but keeps an intentional offline PATCH removal after recovery', async () => {
    const s = mcpServerService.create({ name: 'Server S', type: 'stdio', command: 'unused', isActive: true })
    const t = mcpServerService.create({ name: 'Server T', type: 'stdio', command: 'unused', isActive: true })
    const assistant = assistantDataService.create({ name: 'Assistant A', mcpServerIds: [s.id, t.id] })
    dbh.db.update(assistantMcpServerTable).set({ createdAt: 1000, updatedAt: 2000 }).run()
    const rows = () => dbh.db.select().from(assistantMcpServerTable).all()
    const baseline = rows()
    const catalog = new McpCatalogService()
    MockApplicationUtils.setService('McpCatalogService', catalog)
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const initial = connection()
    const replacement = connection()
    const recovered = connection()
    connectionFactory.create
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce(recovered)

    await catalog.refreshTools(s.id)
    expect(catalog.listTools(s.id)).toMatchObject([{ name: 'read_file', serverId: s.id }])
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${s.id}`)).toMatchObject({ state: 'connected' })
    expect(rows()).toEqual(baseline)

    const failure = new SdkError(SdkErrorCode.RequestTimeout, 'health timeout')
    initial.health.mockRejectedValue(failure)
    await expect(catalog.refreshTools(s.id)).rejects.toBe(failure)
    expect(catalog.listTools(s.id)).toEqual([])
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${s.id}`)).toMatchObject({ state: 'error' })
    expect(rows()).toEqual(baseline)
    await expect(catalog.refreshTools(s.id)).rejects.toBe(failure)
    expect(rows()).toEqual(baseline)

    now += 30_001
    await catalog.refreshTools(s.id)
    expect(catalog.listTools(s.id)).toMatchObject([{ name: 'read_file', serverId: s.id }])
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${s.id}`)).toMatchObject({ state: 'connected' })
    expect(rows()).toEqual(baseline)
    expect(initial.close).toHaveBeenCalledTimes(1)

    replacement.health.mockRejectedValue(failure)
    await expect(catalog.refreshTools(s.id)).rejects.toBe(failure)
    expect(catalog.listTools(s.id)).toEqual([])
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${s.id}`)).toMatchObject({ state: 'error' })
    expect(rows()).toEqual(baseline)
    await expect(
      assistantHandlers['/assistants/:id'].PATCH({
        params: { id: assistant.id },
        body: { mcpServerIds: [t.id] }
      })
    ).resolves.toMatchObject({ mcpServerIds: [t.id] })
    const retained = baseline.filter((row) => row.mcpServerId === t.id)
    expect(rows()).toEqual(retained)

    now += 30_001
    await catalog.refreshTools(s.id)
    expect(catalog.listTools(s.id)).toMatchObject([{ name: 'read_file', serverId: s.id }])
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${s.id}`)).toMatchObject({ state: 'connected' })
    expect(rows()).toEqual(retained)
    expect(assistantDataService.getById(assistant.id).mcpServerIds).toEqual([t.id])
    expect(replacement.close).toHaveBeenCalledTimes(1)
    expect(connectionFactory.create).toHaveBeenCalledTimes(3)
  })
})
