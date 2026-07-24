import { createClient } from '@libsql/client'
import { GetAgentResponseSchema, ListAgentsResponseSchema } from '@types'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetModels, mockInitSkillsForAgent } = vi.hoisted(() => ({
  mockGetModels: vi.fn(),
  mockInitSkillsForAgent: vi.fn()
}))

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: mockGetModels
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/app')
  },
  BrowserWindow: vi.fn(),
  dialog: {},
  ipcMain: {},
  nativeTheme: {
    on: vi.fn(),
    themeSource: 'system',
    shouldUseDarkColors: false
  },
  screen: {},
  session: {},
  shell: {}
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
    macOS: false,
    windows: false,
    linux: true
  }
}))

vi.mock('../../skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: mockInitSkillsForAgent
  }
}))

import {
  type AgentRow,
  agentsTable,
  channelsTable,
  channelTaskSubscriptionsTable,
  scheduledTasksTable,
  sessionMessagesTable,
  sessionsTable,
  taskRunLogsTable
} from '../../database/schema'
import { AgentService } from '../AgentService'

function createSelectQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows)
      }))
    }))
  }
}

function createAgentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent_1783338427757_test',
    type: 'claude-code',
    name: 'Test Agent',
    description: null,
    deleted_at: null,
    accessible_paths: '[]',
    instructions: 'Test instructions',
    model: 'test-model',
    plan_model: null,
    small_model: null,
    mcps: null,
    allowed_tools: null,
    configuration: null,
    sort_order: 0,
    created_at: '2026-07-06T11:47:07.757Z',
    updated_at: '2026-07-06T11:47:07.757Z',
    ...overrides
  }
}

interface TestFsModule {
  mkdtempSync(prefix: string): string
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void
}

interface TestOsModule {
  tmpdir(): string
}

interface TestPathModule {
  join(...paths: string[]): string
}

async function createAgentDatabase(rows: AgentRow[]) {
  const fs = await vi.importActual<TestFsModule>('node:fs')
  const os = await vi.importActual<TestOsModule>('node:os')
  const path = await vi.importActual<TestPathModule>('node:path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-timestamp-test-'))
  const client = createClient({ url: `file:${path.join(directory, 'agents.db')}`, intMode: 'number' })
  const database = drizzle(client)

  await client.execute(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      deleted_at TEXT,
      accessible_paths TEXT,
      instructions TEXT,
      model TEXT NOT NULL,
      plan_model TEXT,
      small_model TEXT,
      mcps TEXT,
      allowed_tools TEXT,
      configuration TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  await database.insert(agentsTable).values(rows)

  return {
    database,
    cleanup: () => {
      client.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}

describe('AgentService built-in agent lifecycle', () => {
  const service = AgentService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips recreating a built-in agent that was soft-deleted by the user', async () => {
    const database = {
      select: vi.fn(() =>
        createSelectQuery([{ id: 'cherry-assistant-default', deleted_at: '2026-04-15T00:00:00.000Z' }])
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const result = await service.initBuiltinAgent({
      id: 'cherry-assistant-default',
      builtinRole: 'assistant',
      provisionWorkspace: vi.fn()
    })

    expect(result).toEqual({ agentId: null, skippedReason: 'deleted' })
    expect(mockGetModels).not.toHaveBeenCalled()
  })

  it('soft-deletes built-in agents while preserving the row', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      select: vi.fn(() => createSelectQuery([{ id: 'cherry-claw-default', deleted_at: null }])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
        callback({ delete: txDelete, update: txUpdate })
      ),
      delete: vi.fn(() => ({ where: deleteWhere }))
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteAgent('cherry-claw-default')

    expect(deleted).toBe(true)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    expect(txDelete).toHaveBeenCalledTimes(6)
    expect(txDelete).toHaveBeenCalledWith(channelTaskSubscriptionsTable)
    expect(txDelete).toHaveBeenCalledWith(taskRunLogsTable)
    expect(txDelete).toHaveBeenCalledWith(scheduledTasksTable)
    expect(txDelete).toHaveBeenCalledWith(sessionMessagesTable)
    expect(txUpdate).toHaveBeenCalledTimes(3)
    expect(database.delete).not.toHaveBeenCalled()
    expect(txUpdate).toHaveBeenCalledWith(channelsTable)
    expect(txUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null }))
    expect(txUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ agentId: null }))
    expect(txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: expect.any(String),
        updated_at: expect.any(String)
      })
    )
  })

  it('deletes regular agents with their sessions and session messages', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      select: vi.fn(() => createSelectQuery([{ id: 'agent-1', deleted_at: null }])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<{ rowsAffected: number }>) =>
        callback({ delete: txDelete, update: txUpdate })
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteAgent('agent-1')

    expect(deleted).toBe(true)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    expect(txDelete).toHaveBeenCalledWith(channelTaskSubscriptionsTable)
    expect(txDelete).toHaveBeenCalledWith(taskRunLogsTable)
    expect(txDelete).toHaveBeenCalledWith(scheduledTasksTable)
    expect(txDelete).toHaveBeenCalledWith(sessionMessagesTable)
    expect(txDelete).toHaveBeenCalledWith(sessionsTable)
    expect(txDelete).toHaveBeenCalledWith(agentsTable)
    expect(txUpdateSet).toHaveBeenCalledWith({ sessionId: null })
    expect(txUpdateSet).toHaveBeenCalledWith({ agentId: null })
  })
})

describe('AgentService data repair', () => {
  const service = AgentService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([
    ['millisecond', '1784810600097Z', '2026-07-23T12:43:20.097Z'],
    ['second', '1784810600Z', '2026-07-23T12:43:20.000Z']
  ])('normalizes an epoch %s timestamp with a trailing Z and persists it', async (_, input, expected) => {
    const { cleanup, database } = await createAgentDatabase([createAgentRow({ updated_at: input })])

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

      const result = await service.listAgents()
      const stored = await database.select().from(agentsTable)

      expect(result.agents[0].updated_at).toBe(expected)
      expect(stored[0].updated_at).toBe(expected)
    } finally {
      cleanup()
    }
  })

  it('leaves valid ISO timestamps untouched without starting a write transaction', async () => {
    const { cleanup, database } = await createAgentDatabase([createAgentRow()])
    const transactionSpy = vi.spyOn(database, 'transaction')

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

      const result = await service.listAgents()

      expect(result.agents[0].created_at).toBe('2026-07-06T11:47:07.757Z')
      expect(result.agents[0].updated_at).toBe('2026-07-06T11:47:07.757Z')
      expect(transactionSpy).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('uses the other valid timestamp when one timestamp is unparseable', async () => {
    const validUpdatedAt = '2026-07-23T11:21:04.074Z'
    const { cleanup, database } = await createAgentDatabase([
      createAgentRow({ created_at: 'not-a-date', updated_at: validUpdatedAt })
    ])

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

      const result = await service.listAgents()
      const stored = await database.select().from(agentsTable)

      expect(result.agents[0].created_at).toBe(validUpdatedAt)
      expect(stored[0].created_at).toBe(validUpdatedAt)
      expect(stored[0].updated_at).toBe(validUpdatedAt)
    } finally {
      cleanup()
    }
  })

  it('uses one current timestamp when both timestamps are unparseable', async () => {
    const fallbackTimestamp = '2026-07-24T08:00:00.000Z'
    const { cleanup, database } = await createAgentDatabase([
      createAgentRow({ created_at: 'invalid-created-at', updated_at: 'invalid-updated-at' })
    ])
    vi.useFakeTimers()
    vi.setSystemTime(new Date(fallbackTimestamp))

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

      const result = await service.listAgents()
      const stored = await database.select().from(agentsTable)

      expect(result.agents[0].created_at).toBe(fallbackTimestamp)
      expect(result.agents[0].updated_at).toBe(fallbackTimestamp)
      expect(stored[0].created_at).toBe(fallbackTimestamp)
      expect(stored[0].updated_at).toBe(fallbackTimestamp)
    } finally {
      cleanup()
    }
  })

  it('returns normalized timestamps when persisting repairs fails', async () => {
    const { cleanup, database } = await createAgentDatabase([createAgentRow({ updated_at: '1784810600097Z' })])
    const databaseWithFailedTransaction = {
      select: database.select.bind(database),
      transaction: vi.fn().mockRejectedValue(new Error('write failed'))
    }

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(databaseWithFailedTransaction as never)

      const result = await service.listAgents()

      expect(result.agents[0].updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(databaseWithFailedTransaction.transaction).toHaveBeenCalledOnce()
    } finally {
      cleanup()
    }
  })

  it('keeps valid MCP IDs, removes invalid entries, and persists the repair', async () => {
    const invalidMcps = JSON.stringify(['server-id', { mcpServers: {} }])
    const { cleanup, database } = await createAgentDatabase([createAgentRow({ mcps: invalidMcps })])

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

      const result = await service.listAgents()
      const stored = await database.select().from(agentsTable)

      expect(result.agents[0].mcps).toEqual(['server-id'])
      expect(stored[0].mcps).toBe(JSON.stringify(['server-id']))
    } finally {
      cleanup()
    }
  })

  it('returns a schema-valid list when timestamps and MCP IDs are corrupted and persistence fails', async () => {
    const invalidMcps = JSON.stringify([
      {
        mcpServers: {
          obsidian: {
            command: 'cmd',
            args: ['/c', 'npx', '-y', '@istrejo/obsidian-mcp'],
            env: { OBSIDIAN_VAULT_PATH: 'C:\\Users\\lenovo\\Documents\\Obsidian Vault' }
          }
        }
      }
    ])
    const { cleanup, database } = await createAgentDatabase([
      createAgentRow({ updated_at: '1784810600097Z', mcps: invalidMcps })
    ])
    const databaseWithFailedTransaction = {
      select: database.select.bind(database),
      transaction: vi.fn().mockRejectedValue(new Error('database is read-only'))
    }

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(databaseWithFailedTransaction as never)

      const result = await service.listAgents()
      const response = {
        data: result.agents,
        total: result.total,
        limit: 20,
        offset: 0
      }

      expect(result.agents[0].updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(result.agents[0].mcps).toEqual([])
      expect(ListAgentsResponseSchema.safeParse(response).success).toBe(true)
      expect(databaseWithFailedTransaction.transaction).toHaveBeenCalledOnce()
    } finally {
      cleanup()
    }
  })

  it('returns a schema-valid agent when its repair cannot be persisted', async () => {
    const agentId = 'agent_1783338427757_corrupted'
    const { cleanup, database } = await createAgentDatabase([
      createAgentRow({
        id: agentId,
        updated_at: '1784810600097Z',
        mcps: JSON.stringify([{ mcpServers: { obsidian: {} } }])
      })
    ])
    const databaseWithFailedTransaction = {
      select: database.select.bind(database),
      transaction: vi.fn().mockRejectedValue(new Error('database is read-only'))
    }

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(databaseWithFailedTransaction as never)

      const agent = await service.getAgent(agentId)

      expect(agent?.updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(agent?.mcps).toEqual([])
      expect(GetAgentResponseSchema.safeParse(agent).success).toBe(true)
      expect(databaseWithFailedTransaction.transaction).toHaveBeenCalledOnce()
    } finally {
      cleanup()
    }
  })

  it('does not overwrite a timestamp changed concurrently after the list query', async () => {
    const agentId = 'agent_1783338427757_concurrent'
    const concurrentUpdatedAt = '2026-07-24T09:00:00.000Z'
    const { cleanup, database } = await createAgentDatabase([
      createAgentRow({ id: agentId, updated_at: '1784810600097Z' })
    ])
    const databaseWithConcurrentUpdate = {
      select: database.select.bind(database),
      transaction: vi.fn(async (callback: Parameters<typeof database.transaction>[0]) => {
        await database.update(agentsTable).set({ updated_at: concurrentUpdatedAt }).where(eq(agentsTable.id, agentId))
        return database.transaction(callback)
      })
    }

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(databaseWithConcurrentUpdate as never)

      const result = await service.listAgents()
      const stored = await database.select().from(agentsTable).where(eq(agentsTable.id, agentId))

      expect(result.agents[0].updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(stored[0].updated_at).toBe(concurrentUpdatedAt)
    } finally {
      cleanup()
    }
  })
})
