import { BackupDomain, ConflictStrategy } from '@shared/backup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DomainImporter as DomainImporterClass } from '../DomainImporter'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

function flattenSqlChunks(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return String(obj ?? '')
  const record = obj as Record<string, unknown>
  if ('value' in record && Array.isArray(record.value)) {
    return (record.value as string[]).join('')
  }
  if ('queryChunks' in record && Array.isArray(record.queryChunks)) {
    return (record.queryChunks as unknown[]).map(flattenSqlChunks).join('')
  }
  return '?'
}

describe('DomainImporter', () => {
  const createMockBackupClient = (
    source: Record<string, unknown>[] | Record<string, Record<string, unknown>[]> = []
  ) => {
    const callCounts = new Map<string, number>()

    return {
      // Return one populated batch per table, then terminate with empty batches.
      execute: vi.fn().mockImplementation(async ({ sql: query }: { sql: string }) => {
        const tableName = /FROM "([^"]+)"/.exec(query)?.[1]
        if (!tableName) return { rows: [] }

        const callCount = callCounts.get(tableName) ?? 0
        callCounts.set(tableName, callCount + 1)

        if (callCount > 0) {
          return { rows: [] }
        }

        if (Array.isArray(source)) {
          return { rows: source }
        }

        return { rows: source[tableName] ?? [] }
      })
    }
  }

  const createMockLiveDb = () => {
    const mockTx = {
      run: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      all: vi.fn().mockResolvedValue([])
    }
    return {
      run: vi.fn(),
      all: vi.fn(),
      transaction: vi.fn().mockImplementation(async (fn) => fn(mockTx)),
      _tx: mockTx
    }
  }

  const createMockRemapper = () => ({
    remap: vi.fn().mockImplementation((id: string) => id),
    addMapping: vi.fn(),
    buildMap: vi.fn(),
    getMap: vi.fn().mockReturnValue(new Map())
  })

  const createMockTracker = () => ({
    incrementItemsProcessed: vi.fn(),
    setPhase: vi.fn(),
    setDomain: vi.fn(),
    setTotals: vi.fn()
  })

  const createMockToken = () => ({
    isCancelled: false,
    cancel: vi.fn(),
    throwIfCancelled: vi.fn()
  })

  let DomainImporter: typeof DomainImporterClass

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../DomainImporter')
    DomainImporter = mod.DomainImporter
  })

  it('returns zero counts for domains with no tables', async () => {
    const importer = new DomainImporter(
      createMockBackupClient() as never,
      createMockLiveDb() as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )
    const result = await importer.importDomain(BackupDomain.FILE_STORAGE, ConflictStrategy.SKIP)
    expect(result).toEqual({ imported: 0, skipped: 0, errors: 0 })
  })

  it('uses ON CONFLICT DO NOTHING for SKIP strategy', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.SKIP)

    expect(liveDb._tx.run).toHaveBeenCalled()
    const sqlStr = flattenSqlChunks(liveDb._tx.run.mock.calls[0][0])
    expect(sqlStr).toContain('ON CONFLICT DO NOTHING')
  })

  it('uses ON CONFLICT DO NOTHING for RENAME strategy (safety net)', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.RENAME)

    expect(liveDb._tx.run).toHaveBeenCalled()
    const sqlStr = flattenSqlChunks(liveDb._tx.run.mock.calls[0][0])
    expect(sqlStr).toContain('ON CONFLICT DO NOTHING')
  })

  it('uses ON CONFLICT DO UPDATE for OVERWRITE strategy', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.OVERWRITE)

    expect(liveDb._tx.run).toHaveBeenCalled()
    const sqlStr = flattenSqlChunks(liveDb._tx.run.mock.calls[0][0])
    expect(sqlStr).toContain('ON CONFLICT DO UPDATE SET')
  })

  it('remaps assistant_id in topic rows using snake_case column name', async () => {
    const oldAssistantId = 'old-assistant-uuid'
    const newAssistantId = 'new-assistant-uuid'
    const rows = [{ id: 'topic-1', group_id: null, active_node_id: null, assistant_id: oldAssistantId, name: 'test' }]
    const backupClient = createMockBackupClient({
      topic: rows
    })
    const liveDb = createMockLiveDb()
    const remapper = createMockRemapper()
    remapper.remap.mockImplementation((id: string) => (id === oldAssistantId ? newAssistantId : id))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.TOPICS, ConflictStrategy.RENAME)

    expect(remapper.remap).toHaveBeenCalledWith(oldAssistantId)
    const sqlStr = flattenSqlChunks(liveDb._tx.run.mock.calls[0][0])
    expect(sqlStr).toContain(newAssistantId)
  })

  it('strips autoincrement PK (id) column for agent_session_message in RENAME', async () => {
    const rows = [{ id: 1, session_id: 'sess-1', content: 'hello' }]
    const backupClient = createMockBackupClient({
      agent_session_message: rows
    })
    const liveDb = createMockLiveDb()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.AGENTS, ConflictStrategy.RENAME)

    const sessionMsgCalls = liveDb._tx.run.mock.calls.filter((call: unknown[]) => {
      const s = flattenSqlChunks(call[0])
      return s.includes('"agent_session_message"')
    })
    for (const call of sessionMsgCalls) {
      const s = flattenSqlChunks(call[0])
      expect(s).not.toMatch(/"id".*VALUES/)
      expect(s).toContain('"session_id"')
    }
  })

  it('performs UNIQUE merge for tag with matching name under RENAME', async () => {
    const rows = [{ id: 'backup-tag-id', name: 'existing-tag' }]
    const backupClient = createMockBackupClient({
      tag: rows
    })
    const liveDb = createMockLiveDb()
    liveDb._tx.all.mockResolvedValueOnce([{ id: 'live-tag-id' }])
    const remapper = createMockRemapper()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    const result = await importer.importDomain(BackupDomain.TAGS_GROUPS, ConflictStrategy.RENAME)

    expect(remapper.addMapping).toHaveBeenCalledWith('backup-tag-id', 'live-tag-id')
    expect(result.skipped).toBeGreaterThanOrEqual(1)
  })

  it('UNIQUE merge uses original backup ID even when buildMap already remapped it', async () => {
    const rows = [{ id: 'backup-tag-id', name: 'existing-tag' }]
    const backupClient = createMockBackupClient({
      tag: rows
    })
    const liveDb = createMockLiveDb()
    liveDb._tx.all.mockResolvedValueOnce([{ id: 'live-tag-id' }])
    const remapper = createMockRemapper()
    remapper.remap.mockImplementation((id: string) => (id === 'backup-tag-id' ? 'remapped-tag-id' : id))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.TAGS_GROUPS, ConflictStrategy.RENAME)

    expect(remapper.addMapping).toHaveBeenCalledWith('backup-tag-id', 'live-tag-id')
    expect(remapper.addMapping).not.toHaveBeenCalledWith('remapped-tag-id', expect.anything())
  })

  it('inserts tag normally when no UNIQUE conflict under RENAME', async () => {
    const rows = [{ id: 'new-tag-id', name: 'brand-new-tag' }]
    const backupClient = createMockBackupClient({
      tag: rows
    })
    const liveDb = createMockLiveDb()
    liveDb._tx.all.mockResolvedValueOnce([])
    const remapper = createMockRemapper()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    const result = await importer.importDomain(BackupDomain.TAGS_GROUPS, ConflictStrategy.RENAME)

    expect(remapper.addMapping).not.toHaveBeenCalled()
    expect(result.imported).toBeGreaterThanOrEqual(1)
  })

  it('tryUniqueMerge proceeds to insert when unique column value is null', async () => {
    const rows = [{ id: 'tag-null', name: null }]
    const backupClient = createMockBackupClient({
      tag: rows
    })
    const liveDb = createMockLiveDb()
    const remapper = createMockRemapper()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    const result = await importer.importDomain(BackupDomain.TAGS_GROUPS, ConflictStrategy.RENAME)

    expect(liveDb._tx.all).not.toHaveBeenCalled()
    expect(remapper.addMapping).not.toHaveBeenCalled()
    expect(result.imported).toBeGreaterThanOrEqual(1)
  })

  it('tryUniqueMerge does not add mapping when backupId equals liveId', async () => {
    const rows = [{ id: 'same-id', name: 'existing-tag' }]
    const backupClient = createMockBackupClient({
      tag: rows
    })
    const liveDb = createMockLiveDb()
    liveDb._tx.all.mockResolvedValueOnce([{ id: 'same-id' }])
    const remapper = createMockRemapper()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    const result = await importer.importDomain(BackupDomain.TAGS_GROUPS, ConflictStrategy.RENAME)

    expect(remapper.addMapping).not.toHaveBeenCalled()
    expect(result.skipped).toBeGreaterThanOrEqual(1)
  })

  it('counts row as skipped when rowsAffected is 0 (ON CONFLICT DO NOTHING)', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()
    liveDb._tx.run.mockResolvedValue({ rowsAffected: 0 })

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    const result = await importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.SKIP)

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('counts row as imported when rowsAffected is 1', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()
    liveDb._tx.run.mockResolvedValue({ rowsAffected: 1 })

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    const result = await importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.SKIP)

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('remaps snake_case FK columns for assistant junction tables', async () => {
    const oldAssistantId = 'old-a-id'
    const newAssistantId = 'new-a-id'
    const oldMcpId = 'old-mcp-id'
    const newMcpId = 'new-mcp-id'
    const rows = [{ assistant_id: oldAssistantId, mcp_server_id: oldMcpId }]
    const backupClient = createMockBackupClient({
      assistant_mcp_server: rows
    })
    const liveDb = createMockLiveDb()
    const remapper = createMockRemapper()
    remapper.remap.mockImplementation((id: string) => {
      if (id === oldAssistantId) return newAssistantId
      if (id === oldMcpId) return newMcpId
      return id
    })

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.ASSISTANTS, ConflictStrategy.RENAME)

    expect(remapper.remap).toHaveBeenCalledWith(oldAssistantId)
    expect(remapper.remap).toHaveBeenCalledWith(oldMcpId)
  })

  it('remaps knowledge_base.group_id under RENAME strategy', async () => {
    const oldGroupId = 'old-group-id'
    const newGroupId = 'new-group-id'
    const rows = [{ id: 'kb-1', group_id: oldGroupId, name: 'test-kb' }]
    const backupClient = createMockBackupClient({
      knowledge_base: rows
    })
    const liveDb = createMockLiveDb()
    const remapper = createMockRemapper()
    remapper.remap.mockImplementation((id: string) => (id === oldGroupId ? newGroupId : id))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.KNOWLEDGE, ConflictStrategy.RENAME)

    expect(remapper.remap).toHaveBeenCalledWith(oldGroupId)
    const sqlStr = flattenSqlChunks(liveDb._tx.run.mock.calls[0][0])
    expect(sqlStr).toContain(newGroupId)
  })

  it('throws on row insert failure under OVERWRITE strategy (domain rollback)', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()
    liveDb._tx.run.mockRejectedValue(new Error('UNIQUE constraint violation'))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await expect(importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.OVERWRITE)).rejects.toThrow(
      'Row insert failed'
    )
  })

  it('throws on row insert failure under RENAME strategy (domain rollback)', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()
    liveDb._tx.run.mockRejectedValue(new Error('UNIQUE constraint violation'))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await expect(importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.RENAME)).rejects.toThrow(
      'Row insert failed'
    )
  })

  it('counts row as skipped on insert failure under SKIP strategy', async () => {
    const rows = [{ id: '1', name: 'test-mcp' }]
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
    const liveDb = createMockLiveDb()
    liveDb._tx.run.mockRejectedValue(new Error('UNIQUE constraint violation'))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      createMockRemapper() as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    const result = await importer.importDomain(BackupDomain.MCP_SERVERS, ConflictStrategy.SKIP)
    expect(result.skipped).toBe(1)
    expect(result.imported).toBe(0)
  })

  it('remaps fileId in message.data blocks during RENAME', async () => {
    const oldFileId = 'old-file-id'
    const newFileId = 'new-file-id'
    const dataJson = JSON.stringify({ blocks: [{ type: 'file', fileId: oldFileId }] })
    const rows = [{ id: 'msg-1', topic_id: 't1', data: dataJson }]
    const backupClient = createMockBackupClient({ message: rows })
    const liveDb = createMockLiveDb()
    const remapper = createMockRemapper()
    remapper.remap.mockImplementation((id: string) => (id === oldFileId ? newFileId : id))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.TOPICS, ConflictStrategy.RENAME)

    expect(remapper.remap).toHaveBeenCalledWith(oldFileId)
    const insertCall = liveDb._tx.run.mock.calls[0][0]
    const sqlStr = flattenSqlChunks(insertCall)
    expect(sqlStr).toContain(newFileId)
  })

  it('preserves malformed message.data during RENAME', async () => {
    const badJson = 'not-valid-json'
    const rows = [{ id: 'msg-1', topic_id: 't1', data: badJson }]
    const backupClient = createMockBackupClient({ message: rows })
    const liveDb = createMockLiveDb()
    const remapper = createMockRemapper()

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    // Should not throw despite malformed JSON
    await importer.importDomain(BackupDomain.TOPICS, ConflictStrategy.RENAME)
    expect(liveDb._tx.run).toHaveBeenCalled()
  })

  it('preserves unrelated block data in message.data during RENAME', async () => {
    const dataJson = JSON.stringify({
      blocks: [
        { type: 'main_text', content: 'hello' },
        { type: 'file', fileId: 'fid-remapped' },
        { type: 'thinking', content: 'reasoning' }
      ]
    })
    const rows = [{ id: 'msg-1', topic_id: 't1', data: dataJson }]
    const backupClient = createMockBackupClient({ message: rows })
    const liveDb = createMockLiveDb()
    const remapper = createMockRemapper()
    remapper.remap.mockImplementation((id: string) => (id === 'fid-remapped' ? 'fid-new' : id))

    const importer = new DomainImporter(
      backupClient as never,
      liveDb as never,
      remapper as never,
      createMockTracker() as never,
      createMockToken() as never
    )

    await importer.importDomain(BackupDomain.TOPICS, ConflictStrategy.RENAME)

    const insertCall = liveDb._tx.run.mock.calls[0][0]
    const sqlStr = flattenSqlChunks(insertCall)
    expect(sqlStr).toContain('fid-new')
    expect(sqlStr).toContain('main_text')
    expect(sqlStr).toContain('thinking')
  })
})
