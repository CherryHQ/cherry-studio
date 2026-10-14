import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AgentsFilesystemMigrationModule from '../agentsFilesystemMigration'

const { stageLegacyAgentFilesMock } = vi.hoisted(() => ({
  stageLegacyAgentFilesMock: vi.fn()
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

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  // AgentsMigrator passes FileManager to importLegacySessionMessages so it can
  // promote v1 inline base64 images. Tests don't exercise that path — a stub
  // suffices.
  const overrides = {
    FileManager: { createInternalEntry: vi.fn(), getUrl: vi.fn() }
  } as Parameters<typeof mockApplicationFactory>[0]
  return mockApplicationFactory(overrides)
})

vi.mock('../agentsFilesystemMigration', async (importOriginal) => {
  const original = await importOriginal<typeof AgentsFilesystemMigrationModule>()
  return { ...original, stageLegacyAgentFiles: stageLegacyAgentFilesMock }
})

import { LegacyAgentsDbReader } from '../../utils/LegacyAgentsDbReader'
import { AgentsMigrator, backfillAgentOrderKeys, migrateAgentMcps } from '../AgentsMigrator'
import { AGENTS_TABLE_MIGRATION_SPECS } from '../mappings/AgentsDbMappings'

function createCounts() {
  return {
    agents: 1,
    sessions: 2,
    skills: 3,
    agent_skills: 4,
    scheduled_tasks: 5,
    task_run_logs: 6,
    channels: 7,
    channel_task_subscriptions: 8,
    session_messages: 9
  }
}

function createSchemaInfo() {
  return {
    agents: { exists: true, columns: new Set(['id']) },
    sessions: { exists: true, columns: new Set(['id']) },
    skills: { exists: true, columns: new Set(['id']) },
    agent_skills: { exists: true, columns: new Set(['agent_id', 'skill_id']) },
    scheduled_tasks: { exists: true, columns: new Set(['id']) },
    task_run_logs: { exists: true, columns: new Set(['id']) },
    channels: { exists: true, columns: new Set(['id']) },
    channel_task_subscriptions: { exists: true, columns: new Set(['channel_id']) },
    session_messages: { exists: true, columns: new Set(['id']) }
  }
}

function createMigrationContext(overrides: Record<string, unknown> = {}) {
  return {
    paths: {
      legacyAgentDbFile: '/mock/Data/agents.db',
      legacyClaudeConfigDir: '/mock/.claude',
      legacyClaudeProjectsDir: '/mock/.claude/projects',
      claudeConfigDir: '/mock/Data/Agents/.claude',
      claudeProjectsDir: '/mock/Data/Agents/.claude/projects'
    },
    sharedData: new Map(),
    ...overrides
  } as never
}

function getExecutedSql(run: ReturnType<typeof vi.fn<(...args: any[]) => any>>) {
  return run.mock.calls.map(([statement]) => statement.queryChunks[0]?.value?.[0])
}

function withSynchronousTransaction<T extends object>(members: T) {
  const transaction = vi.fn()
  const db = { ...members, transaction }
  transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db))
  return db
}

describe('AgentsMigrator', () => {
  let migrator: AgentsMigrator

  beforeEach(() => {
    migrator = new AgentsMigrator()
    vi.restoreAllMocks()
    stageLegacyAgentFilesMock.mockReset()
    stageLegacyAgentFilesMock.mockResolvedValue({ skippedTargetCount: 0 })
  })

  it('prepare skips cleanly when no legacy agents db exists', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue(null)

    const result = await migrator.prepare(createMigrationContext())

    expect(result.success).toBe(true)
    expect(result.itemCount).toBe(0)
    expect(result.warnings).toEqual(['agents.db not found - no agents data to migrate'])
  })

  it('preserves a non-SQLite legacy agents db and lets the remaining migration continue', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'agents-migrator-invalid-db-'))
    const dataDir = join(tempRoot, 'Data')
    const dbPath = join(dataDir, 'agents.db')
    const context = createMigrationContext({
      paths: {
        legacyAgentDbFile: dbPath,
        legacyClaudeConfigDir: join(tempRoot, '.claude'),
        legacyClaudeProjectsDir: join(tempRoot, '.claude', 'projects'),
        claudeConfigDir: join(dataDir, 'Agents', '.claude'),
        claudeProjectsDir: join(dataDir, 'Agents', '.claude', 'projects')
      }
    })
    await mkdir(dataDir)
    await writeFile(dbPath, 'not a sqlite database')

    try {
      const prepareResult = await migrator.prepare(context)
      const executeResult = await migrator.execute(context)
      const validateResult = await migrator.validate(context)

      expect(prepareResult).toEqual({
        success: true,
        itemCount: 0,
        warningMessages: [{ key: 'migration.completed.agent_database_unreadable' }]
      })
      expect(executeResult).toEqual({ success: true, processedCount: 0 })
      expect(validateResult.success).toBe(true)
      expect(await readFile(dbPath, 'utf8')).toBe('not a sqlite database')
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('does not hide retryable legacy agents database errors', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockImplementation(() => {
      throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    })

    await expect(migrator.prepare(createMigrationContext())).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
  })

  it('copies the legacy Claude config even when no legacy agents db exists', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue(null)
    const tempRoot = await mkdtemp(join(tmpdir(), 'agents-migrator-claude-config-'))
    const source = join(tempRoot, '.claude')
    const destination = join(tempRoot, 'Data', 'Agents', '.claude')
    const progressKeys: string[] = []
    const progressValues: number[] = []
    migrator.setProgressCallback((progress, message) => {
      progressValues.push(progress)
      if (message.i18nMessage) progressKeys.push(message.i18nMessage.key)
    })
    await mkdir(source)
    await writeFile(join(source, 'settings.json'), '{"migrated":true}')

    try {
      await migrator.execute(
        createMigrationContext({
          paths: {
            legacyAgentDbFile: join(tempRoot, 'Data', 'agents.db'),
            legacyClaudeConfigDir: source,
            legacyClaudeProjectsDir: join(source, 'projects'),
            claudeConfigDir: destination,
            claudeProjectsDir: join(destination, 'projects')
          }
        })
      )

      expect(await readFile(join(destination, 'settings.json'), 'utf8')).toBe('{"migrated":true}')
      expect(await readFile(join(source, 'settings.json'), 'utf8')).toBe('{"migrated":true}')
      expect(progressKeys).toEqual(
        expect.arrayContaining([
          'migration.progress.agents_claude_config_scanning',
          'migration.progress.agents_claude_config_copying',
          'migration.progress.agents_claude_config_verifying'
        ])
      )
      expect(progressValues).toEqual(expect.arrayContaining([15, 30, 44, 45]))
      expect(progressValues.every((progress, index) => index === 0 || progress >= progressValues[index - 1])).toBe(true)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('reports monotonic Agent subphase progress through validation', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue(null)
    const progressValues: number[] = []
    migrator.setProgressCallback((progress) => progressValues.push(progress))

    const context = createMigrationContext()
    await migrator.execute(context)
    await migrator.validate(context)

    expect(progressValues).toEqual([1, 45, 98, 99, 100])
    expect(progressValues.every((progress, index) => index === 0 || progress >= progressValues[index - 1])).toBe(true)
  })

  it('prepare counts all legacy agents rows', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(createSchemaInfo())
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(createCounts())

    const result = await migrator.prepare(createMigrationContext())

    expect(result.success).toBe(true)
    // 1 + 2 + 3 + 4 + 7 + 9 = 26 — only the 6 importStatement-driven specs are
    // counted; the 3 task-related tables migrate via the TS-loop and are
    // accounted for separately.
    expect(result.itemCount).toBe(26)
  })

  it('execute imports every table and reports skipped filesystem targets', async () => {
    const run = vi.fn().mockReturnValue(undefined)
    // remapAgentPrefixIds calls db.select().from().where() to find old-prefix IDs;
    // mock to return empty arrays so the remap loop is a no-op.
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
        where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
        // readSessionAuthors joins agent_session with agent; no sessions in these fixtures.
        innerJoin: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
      })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) })
    })
    // migrateScheduledTasksTs uses db.delete (the agent.task pre-clear) and db.insert
    // (for both jobScheduleTable and agentChannelTaskTable). Stub them out so no
    // schedule rows are emitted; the TS-loop is exercised end-to-end in
    // AgentsMigrator.task.test.ts.
    const del = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
      })
    })
    // remapAgentPrefixIds runs PRAGMA foreign_key_check via db.all; empty => no FK violations.
    const all = vi.fn().mockReturnValue([])

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(createSchemaInfo())
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(createCounts())
    stageLegacyAgentFilesMock.mockResolvedValueOnce({ skippedTargetCount: 2 })

    await migrator.prepare(createMigrationContext())
    const db = withSynchronousTransaction({ run, select, update, all, delete: del, insert })
    const result = await migrator.execute(createMigrationContext({ db }))

    expect(result.success).toBe(true)
    // sourceCounts now sums only the 6 importStatement-driven specs (the 3
    // task-related sources are handled by the TS-loop). 45 - (5 scheduled
    // tasks + 6 run logs + 8 channel_task_subscriptions) = 26.
    expect(result.processedCount).toBe(26)
    expect(result.warningMessages).toEqual([
      {
        key: 'migration.completed.agent_files_skipped',
        params: { count: 2 }
      }
    ])

    const outer = getExecutedSql(run)
    // FK is managed globally by the engine (MigrationDbService sets foreign_keys = OFF once) — no per-migrator
    // PRAGMA toggling. Import phase: ATTACH → BEGIN → [INSERTs] → COMMIT
    expect(outer[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(outer[1]).toBe('BEGIN')
    // run tail after import COMMIT: remapAgentPrefixIds emits BEGIN → COMMIT (no old-prefix
    // IDs here, so no UPDATEs), then execute() drops message staging and emits DETACH.
    const beginIndexes = outer.flatMap((statement, index) => (statement === 'BEGIN' ? [index] : []))
    const commitIndexes = outer.flatMap((statement, index) => (statement === 'COMMIT' ? [index] : []))
    expect(beginIndexes).toHaveLength(2)
    expect(commitIndexes).toHaveLength(2)
    expect(beginIndexes[0]).toBeLessThan(commitIndexes[0])
    expect(commitIndexes[0]).toBeLessThan(beginIndexes[1])
    expect(beginIndexes[1]).toBeLessThan(commitIndexes[1])
    expect(outer.at(-3)).toBe('DROP TABLE IF EXISTS agent_session_message_migration_staging')
    expect(outer.at(-2)).toBe('DROP TABLE IF EXISTS agent_session_message_source_cursor')
    expect(outer.at(-1)).toBe('DETACH DATABASE agents_legacy')
    // Session-workspace staging runs first inside the import transaction, emitted
    // via run() before the table INSERTs.
    expect(outer).toContain(
      'CREATE TEMP TABLE IF NOT EXISTS session_workspace_map (session_id TEXT PRIMARY KEY, workspace_id TEXT)'
    )
    expect(outer).toContain('DELETE FROM session_workspace_map')
    // FK is centralized in the engine now — the migrator emits no PRAGMA toggles.
    expect(outer).not.toContain('PRAGMA foreign_keys = OFF')
    expect(outer).not.toContain('PRAGMA foreign_keys = ON')
    // Raw INSERT statements for migrated tables (excludes specs with manualImport,
    // which importLegacySessionMessages handles via Drizzle helpers, not run()).
    const tableInserts = outer.filter((s: string) => typeof s === 'string' && s.startsWith('INSERT INTO '))
    const expectedTableInserts = AGENTS_TABLE_MIGRATION_SPECS.filter((spec) => !spec.manualImport).length
    expect(tableInserts).toHaveLength(expectedTableInserts)
    // No old-prefix IDs returned → no UPDATE calls
    expect(update).not.toHaveBeenCalled()
    // Agent-domain FK self-check ran (one foreign_key_check per AGENT_TABLES entry)
    expect(all).toHaveBeenCalled()
  })

  it('backfills agent order keys from legacy sort_order before id remap', async () => {
    const all = vi
      .fn()
      .mockReturnValueOnce([{ id: 'agent-b' }, { id: 'agent-a' }])
      .mockReturnValueOnce([])
    const run = vi.fn().mockReturnValue(undefined)

    backfillAgentOrderKeys({ all, run } as never)

    const [query] = all.mock.calls[0]
    expect(query.queryChunks[0]?.value?.[0]).toContain('LEFT JOIN agents_legacy.agents')
    expect(query.queryChunks[0]?.value?.[0]).toContain('ORDER BY COALESCE(s.sort_order, 0) ASC')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('rolls back and detaches when an import statement fails inside the transaction', async () => {
    // First 2 calls succeed (ATTACH, BEGIN), 3rd (first INSERT) fails. FK is managed
    // globally by the engine now, so no per-migrator FK pragma appears in this sequence.
    const run = vi
      .fn()
      .mockReturnValueOnce(undefined) // ATTACH
      .mockReturnValueOnce(undefined) // BEGIN
      .mockImplementationOnce(() => {
        // better-sqlite3 run() is synchronous and throws synchronously on failure.
        throw new Error('insert failed')
      }) // first staged statement fails
      .mockReturnValue(undefined) // ROLLBACK, DETACH

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(createSchemaInfo())
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(createCounts())

    await migrator.prepare(createMigrationContext())
    await expect(migrator.execute(createMigrationContext({ db: { run } }))).rejects.toThrow('insert failed')

    const executed = getExecutedSql(run)
    expect(executed).toContain('ROLLBACK')
    expect(executed).not.toContain('PRAGMA foreign_keys = ON')
    expect(executed.at(-1)).toBe('DETACH DATABASE agents_legacy')
    expect(executed.some((stmt) => stmt?.startsWith('DELETE FROM agent'))).toBe(false)
  })

  it('validate fails when imported table counts are lower than the expected filtered counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(createSchemaInfo())
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(createCounts())

    // Workspace prelude (3 calls): selectLegacySessionWorkspaceRows skips
    // db.all because the test schema lacks `sessions.agent_id`; the other 3
    // (workspaceRows, invalidSessionWorkspaceRows, targetWorkspacePathCounts)
    // fire before the spec loop.
    const all = vi
      .fn()
      .mockReturnValueOnce([{ count: 0 }]) // workspaceRows target
      .mockReturnValueOnce([{ count: 0 }]) // invalidSessionWorkspaceRows
      .mockReturnValueOnce([]) // targetWorkspacePathCounts
      .mockReturnValueOnce([{ count: 0 }]) // agent target (expected 1 → mismatch)
      .mockReturnValueOnce([{ count: 1 }]) // agent expected
      .mockReturnValueOnce([{ count: 2 }]) // agent_session target
      .mockReturnValueOnce([{ count: 2 }]) // agent_session expected
      .mockReturnValueOnce([{ count: 3 }]) // agent_global_skill target
      .mockReturnValueOnce([{ count: 3 }]) // agent_global_skill expected
      .mockReturnValueOnce([{ count: 4 }]) // agent_skill target
      .mockReturnValueOnce([{ count: 4 }]) // agent_skill expected
      .mockReturnValueOnce([{ count: 6 }]) // agent_channel target (expected 7 → mismatch)
      .mockReturnValueOnce([{ count: 7 }]) // agent_channel expected
      .mockReturnValueOnce([{ count: 9 }]) // agent_session_message target
      .mockReturnValueOnce([{ count: 9 }]) // agent_session_message expected

    const run = vi.fn().mockReturnValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { all, run } }))

    expect(result.success).toBe(false)
    expect(result.errors.map((error) => error.key)).toEqual(['agent_count_mismatch', 'agent_channel_count_mismatch'])
    // sourceCount sums the 6 importStatement-driven specs (scheduled_tasks,
    // run_logs, channel_task_subscriptions migrate via the TS-loop). targetCount
    // = 0 + 2 + 3 + 4 + 6 + 9 = 24, with the agent and agent_channel mismatches
    // bringing the total below the 26-row expectation.
    expect(result.stats.sourceCount).toBe(26)
    expect(result.stats.targetCount).toBe(24)
  })

  it('validate skips specs whose source table is missing from the legacy db', async () => {
    // Reproduces the production crash where a legacy agents.db lacks newer
    // tables (e.g. agent_skills): validate would otherwise SELECT FROM
    // agents_legacy.agent_skills and the SQLite engine would raise
    // "no such table: agents_legacy.agent_skills".
    const partialSchema = createSchemaInfo()
    partialSchema.agent_skills = { exists: false, columns: new Set() }
    partialSchema.session_messages = { exists: false, columns: new Set() }
    const partialCounts = { ...createCounts(), agent_skills: 0, session_messages: 0 }

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(partialSchema)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(partialCounts)

    // 3 workspace-prelude calls + 4 present specs × 2 = 11 total. Each present
    // spec issues two queries (target count + expected count) and the workspace
    // prelude fires workspaceRows + invalidSessionWorkspaceRows + path counts
    // before the spec loop. If the spec-skip guard regresses, the mock will run
    // out of queued responses and return undefined, surfacing the failure.
    const all = vi
      .fn()
      .mockReturnValueOnce([{ count: 0 }]) // workspaceRows target
      .mockReturnValueOnce([{ count: 0 }]) // invalidSessionWorkspaceRows
      .mockReturnValueOnce([]) // targetWorkspacePathCounts
    for (let i = 0; i < 4; i++) {
      all.mockReturnValueOnce([{ count: 1 }]).mockReturnValueOnce([{ count: 1 }])
    }

    const run = vi.fn().mockReturnValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { all, run } }))

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(all).toHaveBeenCalledTimes(11)
    const queries = all.mock.calls.map(([statement]) => statement.queryChunks[0]?.value?.[0])
    expect(queries.some((q) => q?.includes('agents_legacy.agent_skills'))).toBe(false)
    expect(queries.some((q) => q?.includes('agents_legacy.session_messages'))).toBe(false)
  })

  it('validate flags target tables whose row count exceeds the expected filtered count', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(createSchemaInfo())
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(createCounts())

    const all = vi
      .fn()
      .mockReturnValueOnce([{ count: 0 }]) // workspaceRows target
      .mockReturnValueOnce([{ count: 0 }]) // invalidSessionWorkspaceRows
      .mockReturnValueOnce([]) // targetWorkspacePathCounts
      .mockReturnValueOnce([{ count: 2 }]) // agent target (expected 1 → too high)
      .mockReturnValueOnce([{ count: 1 }]) // agent expected
      .mockReturnValueOnce([{ count: 2 }]) // agent_session target
      .mockReturnValueOnce([{ count: 2 }]) // agent_session expected
      .mockReturnValueOnce([{ count: 3 }]) // agent_global_skill target
      .mockReturnValueOnce([{ count: 3 }]) // agent_global_skill expected
      .mockReturnValueOnce([{ count: 4 }]) // agent_skill target
      .mockReturnValueOnce([{ count: 4 }]) // agent_skill expected
      .mockReturnValueOnce([{ count: 7 }]) // agent_channel target
      .mockReturnValueOnce([{ count: 7 }]) // agent_channel expected
      .mockReturnValueOnce([{ count: 9 }]) // agent_session_message target
      .mockReturnValueOnce([{ count: 9 }]) // agent_session_message expected

    const run = vi.fn().mockReturnValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { all, run } }))

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([
      expect.objectContaining({
        key: 'agent_count_mismatch',
        expected: 1,
        actual: 2,
        message: expect.stringContaining('too high')
      })
    ])
  })

  it('resolves the legacy db path once and reuses it across phases', async () => {
    const resolvePath = vi
      .spyOn(LegacyAgentsDbReader.prototype, 'resolvePath')
      .mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(createSchemaInfo())
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(createCounts())

    const run = vi.fn().mockReturnValue(undefined)
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
        where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
        // readSessionAuthors joins agent_session with agent; no sessions in these fixtures.
        innerJoin: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
      })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) })
    })
    const del = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
      })
    })
    const all = vi.fn().mockReturnValue([])
    const migrationContext = createMigrationContext({
      db: withSynchronousTransaction({ run, select, update, all, delete: del, insert })
    })

    await migrator.prepare(migrationContext)
    await migrator.execute(migrationContext)
    await migrator.validate(migrationContext)

    expect(resolvePath).toHaveBeenCalledTimes(1)
  })

  it('validate attaches the legacy db to compare against expected filtered counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockReturnValue(createSchemaInfo())
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockReturnValue(createCounts())

    const run = vi.fn().mockReturnValue(undefined)
    const all = vi.fn().mockReturnValue([{ count: 1 }])

    await migrator.prepare(createMigrationContext())
    await migrator.validate(createMigrationContext({ db: { run, all } }))

    expect(getExecutedSql(run)[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(getExecutedSql(run).at(-1)).toBe('DETACH DATABASE agents_legacy')
  })

  describe('migrateAgentMcps', () => {
    it('remaps legacy mcp ids to new ids and inserts junction rows', async () => {
      const all = vi.fn().mockReturnValue([
        { agentId: 'agent-1', mcps: JSON.stringify(['mcp-a', 'mcp-b']) },
        { agentId: 'agent-2', mcps: JSON.stringify(['mcp-a']) }
      ])
      const run = vi.fn()
      const onConflictDoNothing = vi.fn().mockReturnValue({ run })
      const valuesFn = vi.fn().mockReturnValue({ onConflictDoNothing })
      const insert = vi.fn().mockReturnValue({ values: valuesFn })
      const mapping = new Map([
        ['mcp-a', 'new-a'],
        ['mcp-b', 'new-b']
      ])

      migrateAgentMcps({ all, insert } as never, mapping)

      expect(all).toHaveBeenCalledTimes(1)
      // Batch insert — single values() call with 3 remapped rows
      expect(insert).toHaveBeenCalledTimes(1)
      expect(valuesFn).toHaveBeenCalledTimes(1)
      const valuesCall = valuesFn.mock.calls[0][0]
      expect(valuesCall).toHaveLength(3)
      expect(valuesCall).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentId: 'agent-1', mcpServerId: 'new-a' }),
          expect.objectContaining({ agentId: 'agent-1', mcpServerId: 'new-b' }),
          expect.objectContaining({ agentId: 'agent-2', mcpServerId: 'new-a' })
        ])
      )
      expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('drops legacy refs whose id is missing from the mapping', async () => {
      const all = vi.fn().mockReturnValue([{ agentId: 'agent-1', mcps: JSON.stringify(['mcp-a', 'mcp-gone']) }])
      const run = vi.fn()
      const onConflictDoNothing = vi.fn().mockReturnValue({ run })
      const valuesFn = vi.fn().mockReturnValue({ onConflictDoNothing })
      const insert = vi.fn().mockReturnValue({ values: valuesFn })
      const mapping = new Map([['mcp-a', 'new-a']])

      migrateAgentMcps({ all, insert } as never, mapping)

      expect(insert).toHaveBeenCalledTimes(1)
      const valuesCall = valuesFn.mock.calls[0][0]
      expect(valuesCall).toHaveLength(1)
      expect(valuesCall[0]).toEqual(expect.objectContaining({ agentId: 'agent-1', mcpServerId: 'new-a' }))
      expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('skips insert when no rows match the query', async () => {
      const all = vi.fn().mockReturnValue([])
      const insert = vi.fn()

      migrateAgentMcps({ all, insert } as never, new Map())

      expect(all).toHaveBeenCalledTimes(1)
      expect(insert).not.toHaveBeenCalled()
    })

    it('skips non-array legacy MCP payloads', async () => {
      const all = vi.fn().mockReturnValue([{ agentId: 'agent-1', mcps: JSON.stringify({ id: 'mcp-a' }) }])
      const insert = vi.fn()

      migrateAgentMcps({ all, insert } as never, new Map())

      expect(insert).not.toHaveBeenCalled()
    })

    it('keeps valid string ids from mixed legacy MCP arrays', async () => {
      const all = vi.fn().mockReturnValue([{ agentId: 'agent-1', mcps: JSON.stringify(['mcp-a', 123]) }])
      const run = vi.fn()
      const onConflictDoNothing = vi.fn().mockReturnValue({ run })
      const valuesFn = vi.fn().mockReturnValue({ onConflictDoNothing })
      const insert = vi.fn().mockReturnValue({ values: valuesFn })

      migrateAgentMcps({ all, insert } as never, new Map([['mcp-a', 'new-a']]))

      expect(valuesFn.mock.calls[0][0]).toEqual([expect.objectContaining({ agentId: 'agent-1', mcpServerId: 'new-a' })])
    })

    it('throws when rows need remapping but the mapping is absent', async () => {
      const all = vi.fn().mockReturnValue([{ agentId: 'agent-1', mcps: JSON.stringify(['mcp-a']) }])
      const insert = vi.fn()

      expect(() => migrateAgentMcps({ all, insert } as never, undefined)).toThrow(/mcpServerIdMapping not found/)
      expect(insert).not.toHaveBeenCalled()
    })
  })
})
