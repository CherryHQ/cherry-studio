import { BackupDomain, ConflictStrategy } from '@shared/backup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
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
  const createMockBackupClient = (rows: Record<string, unknown>[] = []) => ({
    execute: vi.fn().mockResolvedValue({ rows })
  })

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

  let DomainImporter: typeof import('../DomainImporter').DomainImporter

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
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
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
    const backupClient = createMockBackupClient(rows)
    backupClient.execute
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
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
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
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
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
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
    const backupClient = createMockBackupClient(rows)
    backupClient.execute.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [] })
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
    const backupClient = createMockBackupClient(rows)
    backupClient.execute
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
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
})
