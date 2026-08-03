import { createClient } from '@libsql/client'
import { GetAgentSessionResponseSchema, ListAgentSessionsResponseSchema } from '@types'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@main/utils/markdownParser', () => ({
  parsePluginMetadata: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn()
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

import {
  channelsTable,
  sessionMessagesTable,
  type SessionRow,
  sessionsTable,
  taskRunLogsTable
} from '../../database/schema'
import { SessionService } from '../SessionService'

function createSessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'session_1783338427757_test',
    agent_type: 'claude-code',
    agent_id: 'agent_1783338427757_test',
    name: 'Test Session',
    description: null,
    accessible_paths: '[]',
    instructions: 'Test instructions',
    model: 'test-model',
    plan_model: null,
    small_model: null,
    mcps: null,
    allowed_tools: null,
    slash_commands: JSON.stringify([{ command: '/test', description: 'Test command' }]),
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

async function createSessionDatabase(rows: SessionRow[]) {
  const fs = await vi.importActual<TestFsModule>('node:fs')
  const os = await vi.importActual<TestOsModule>('node:os')
  const path = await vi.importActual<TestPathModule>('node:path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-session-repair-test-'))
  const client = createClient({ url: `file:${path.join(directory, 'agents.db')}`, intMode: 'number' })
  const database = drizzle(client)

  await client.execute(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      accessible_paths TEXT,
      instructions TEXT,
      model TEXT NOT NULL,
      plan_model TEXT,
      small_model TEXT,
      mcps TEXT,
      allowed_tools TEXT,
      slash_commands TEXT,
      configuration TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  await database.insert(sessionsTable).values(rows)

  return {
    database,
    cleanup: () => {
      client.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}

describe('SessionService deleteSession', () => {
  const service = SessionService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cleans associated data and then deletes the session row in one transaction', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<boolean>) =>
        callback({
          delete: txDelete,
          update: txUpdate
        })
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteSession('agent-1', 'session-1')

    expect(deleted).toBe(true)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    expect(txUpdate).toHaveBeenCalledWith(channelsTable)
    expect(txUpdate).toHaveBeenCalledWith(taskRunLogsTable)
    expect(txUpdateSet).toHaveBeenCalledWith({ sessionId: null })
    expect(txUpdateSet).toHaveBeenCalledWith({ session_id: null })
    expect(txDelete).toHaveBeenNthCalledWith(1, sessionMessagesTable)
    expect(txDelete).toHaveBeenNthCalledWith(2, sessionsTable)
  })

  it('returns false when the session does not belong to the agent', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 0 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<boolean>) =>
        callback({
          delete: txDelete,
          update: txUpdate
        })
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteSession('agent-1', 'session-1')

    expect(deleted).toBe(false)
    expect(txDelete).toHaveBeenCalledTimes(2)
    expect(txDelete).toHaveBeenCalledWith(sessionMessagesTable)
    expect(txDelete).toHaveBeenCalledWith(sessionsTable)
    expect(txUpdate).toHaveBeenCalledWith(channelsTable)
    expect(txUpdate).toHaveBeenCalledWith(taskRunLogsTable)
  })
})

describe('SessionService data repair', () => {
  const service = SessionService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists normalized timestamps and valid MCP IDs', async () => {
    const invalidMcps = JSON.stringify(['server-id', { mcpServers: {} }])
    const { cleanup, database } = await createSessionDatabase([
      createSessionRow({ updated_at: '1784810600097Z', mcps: invalidMcps })
    ])

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

      const result = await service.listSessions('agent_1783338427757_test')
      const stored = await database.select().from(sessionsTable)

      expect(result.sessions[0].updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(result.sessions[0].mcps).toEqual(['server-id'])
      expect(stored[0].updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(stored[0].mcps).toBe(JSON.stringify(['server-id']))
    } finally {
      cleanup()
    }
  })

  it('returns a schema-valid list when persistence fails', async () => {
    const { cleanup, database } = await createSessionDatabase([
      createSessionRow({
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

      const result = await service.listSessions('agent_1783338427757_test')
      const response = {
        data: result.sessions,
        total: result.total,
        limit: 20,
        offset: 0
      }

      expect(result.sessions[0].updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(result.sessions[0].mcps).toEqual([])
      expect(ListAgentSessionsResponseSchema.safeParse(response).success).toBe(true)
      expect(databaseWithFailedTransaction.transaction).toHaveBeenCalledOnce()
    } finally {
      cleanup()
    }
  })

  it('returns a schema-valid session when persistence fails', async () => {
    const sessionId = 'session_1783338427757_corrupted'
    const agentId = 'agent_1783338427757_test'
    const { cleanup, database } = await createSessionDatabase([
      createSessionRow({
        id: sessionId,
        agent_id: agentId,
        created_at: 'invalid-created-at',
        updated_at: '2026-07-23T12:43:20.097Z',
        mcps: JSON.stringify([{ mcpServers: { obsidian: {} } }])
      })
    ])
    const databaseWithFailedTransaction = {
      select: database.select.bind(database),
      transaction: vi.fn().mockRejectedValue(new Error('database is read-only'))
    }

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(databaseWithFailedTransaction as never)

      const session = await service.getSession(agentId, sessionId)

      expect(session?.created_at).toBe('2026-07-23T12:43:20.097Z')
      expect(session?.mcps).toEqual([])
      expect(GetAgentSessionResponseSchema.safeParse(session).success).toBe(true)
      expect(databaseWithFailedTransaction.transaction).toHaveBeenCalledOnce()
    } finally {
      cleanup()
    }
  })

  it('does not overwrite a session timestamp changed concurrently after the list query', async () => {
    const sessionId = 'session_1783338427757_concurrent'
    const concurrentUpdatedAt = '2026-07-24T09:00:00.000Z'
    const { cleanup, database } = await createSessionDatabase([
      createSessionRow({ id: sessionId, updated_at: '1784810600097Z' })
    ])
    const databaseWithConcurrentUpdate = {
      select: database.select.bind(database),
      transaction: vi.fn(async (callback: Parameters<typeof database.transaction>[0]) => {
        await database
          .update(sessionsTable)
          .set({ updated_at: concurrentUpdatedAt })
          .where(eq(sessionsTable.id, sessionId))
        return database.transaction(callback)
      })
    }

    try {
      vi.spyOn(service as never, 'getDatabase').mockResolvedValue(databaseWithConcurrentUpdate as never)

      const result = await service.listSessions('agent_1783338427757_test')
      const stored = await database.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId))

      expect(result.sessions[0].updated_at).toBe('2026-07-23T12:43:20.097Z')
      expect(stored[0].updated_at).toBe(concurrentUpdatedAt)
    } finally {
      cleanup()
    }
  })
})
