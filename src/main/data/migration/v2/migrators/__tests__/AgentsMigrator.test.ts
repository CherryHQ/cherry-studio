import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { LegacyAgentsDbReader } from '../../utils/LegacyAgentsDbReader'
import { AgentsMigrator, backfillAgentOrderKeys } from '../AgentsMigrator'
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
      legacyAgentDbFile: '/mock/Data/agents.db'
    },
    ...overrides
  } as never
}

function getExecutedSql(run: ReturnType<typeof vi.fn>) {
  return run.mock.calls.map(([statement]) => statement.queryChunks[0]?.value?.[0])
}

describe('AgentsMigrator', () => {
  let migrator: AgentsMigrator

  beforeEach(() => {
    migrator = new AgentsMigrator()
    vi.restoreAllMocks()
  })

  it('prepare skips cleanly when no legacy agents db exists', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue(null)

    const result = await migrator.prepare(createMigrationContext())

    expect(result.success).toBe(true)
    expect(result.itemCount).toBe(0)
    expect(result.warnings).toEqual(['agents.db not found - no agents data to migrate'])
  })

  it('prepare counts all legacy agents rows', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const result = await migrator.prepare(createMigrationContext())

    expect(result.success).toBe(true)
    // 1 + 2 + 3 + 4 + 7 + 9 = 26 — only the 6 importStatement-driven specs are
    // counted; the 3 task-related tables migrate via the TS-loop and are
    // accounted for separately.
    expect(result.itemCount).toBe(26)
  })

  it('execute attaches the legacy db and imports every table without per-migrator FK toggling', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    // remapAgentPrefixIds calls db.select().from().where() to find old-prefix IDs;
    // mock to return empty arrays so the remap loop is a no-op.
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]), where: vi.fn().mockResolvedValue([]) })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
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
    const all = vi.fn().mockResolvedValue([])

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    const result = await migrator.execute(
      createMigrationContext({ db: { run, select, update, all, delete: del, insert } })
    )

    expect(result.success).toBe(true)
    // sourceCounts now sums only the 6 importStatement-driven specs (the 3
    // task-related sources are handled by the TS-loop). 45 - (5 scheduled
    // tasks + 6 run logs + 8 channel_task_subscriptions) = 26.
    expect(result.processedCount).toBe(26)

    const outer = getExecutedSql(run)
    // FK is managed globally by the engine (MigrationDbService setPragma) — no per-migrator
    // PRAGMA toggling. Import phase: ATTACH → BEGIN → [INSERTs] → COMMIT
    expect(outer[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(outer[1]).toBe('BEGIN')
    // run tail after import COMMIT: remapAgentPrefixIds emits BEGIN → COMMIT (no old-prefix
    // IDs here, so no UPDATEs), then execute() emits DETACH.
    expect(outer.at(-4)).toBe('COMMIT')
    expect(outer.at(-3)).toBe('BEGIN')
    expect(outer.at(-2)).toBe('COMMIT')
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
      .mockResolvedValueOnce([{ id: 'agent-b' }, { id: 'agent-a' }])
      .mockResolvedValueOnce([])
    const run = vi.fn().mockResolvedValue(undefined)

    await backfillAgentOrderKeys({ all, run } as never)

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
      .mockResolvedValueOnce(undefined) // ATTACH
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('insert failed')) // first INSERT fails
      .mockResolvedValue(undefined) // ROLLBACK, DETACH

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

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
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    // Workspace prelude (3 calls): selectLegacySessionWorkspaceRows skips
    // db.all because the test schema lacks `sessions.agent_id`; the other 3
    // (workspaceRows, invalidSessionWorkspaceRows, targetWorkspacePathCounts)
    // fire before the spec loop.
    const all = vi
      .fn()
      .mockResolvedValueOnce([{ count: 0 }]) // workspaceRows target
      .mockResolvedValueOnce([{ count: 0 }]) // invalidSessionWorkspaceRows
      .mockResolvedValueOnce([]) // targetWorkspacePathCounts
      .mockResolvedValueOnce([{ count: 0 }]) // agent target (expected 1 → mismatch)
      .mockResolvedValueOnce([{ count: 1 }]) // agent expected
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session target
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session expected
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill target
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill expected
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill target
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill expected
      .mockResolvedValueOnce([{ count: 6 }]) // agent_channel target (expected 7 → mismatch)
      .mockResolvedValueOnce([{ count: 7 }]) // agent_channel expected
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message target
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message expected

    const run = vi.fn().mockResolvedValue(undefined)

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
    // agents_legacy.agent_skills and the libsql client would raise
    // "no such table: agents_legacy.agent_skills".
    const partialSchema = createSchemaInfo()
    partialSchema.agent_skills = { exists: false, columns: new Set() }
    partialSchema.session_messages = { exists: false, columns: new Set() }
    const partialCounts = { ...createCounts(), agent_skills: 0, session_messages: 0 }

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(partialSchema as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(partialCounts)

    // 3 workspace-prelude calls + 4 present specs × 2 = 11 total. Each present
    // spec issues two queries (target count + expected count) and the workspace
    // prelude fires workspaceRows + invalidSessionWorkspaceRows + path counts
    // before the spec loop. If the spec-skip guard regresses, the mock will run
    // out of queued responses and return undefined, surfacing the failure.
    const all = vi
      .fn()
      .mockResolvedValueOnce([{ count: 0 }]) // workspaceRows target
      .mockResolvedValueOnce([{ count: 0 }]) // invalidSessionWorkspaceRows
      .mockResolvedValueOnce([]) // targetWorkspacePathCounts
    for (let i = 0; i < 4; i++) {
      all.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([{ count: 1 }])
    }

    const run = vi.fn().mockResolvedValue(undefined)

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
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const all = vi
      .fn()
      .mockResolvedValueOnce([{ count: 0 }]) // workspaceRows target
      .mockResolvedValueOnce([{ count: 0 }]) // invalidSessionWorkspaceRows
      .mockResolvedValueOnce([]) // targetWorkspacePathCounts
      .mockResolvedValueOnce([{ count: 2 }]) // agent target (expected 1 → too high)
      .mockResolvedValueOnce([{ count: 1 }]) // agent expected
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session target
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session expected
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill target
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill expected
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill target
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill expected
      .mockResolvedValueOnce([{ count: 7 }]) // agent_channel target
      .mockResolvedValueOnce([{ count: 7 }]) // agent_channel expected
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message target
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message expected

    const run = vi.fn().mockResolvedValue(undefined)

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
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const run = vi.fn().mockResolvedValue(undefined)
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]), where: vi.fn().mockResolvedValue([]) })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
    const del = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
      })
    })
    const all = vi.fn().mockResolvedValue([])
    const migrationContext = createMigrationContext({
      db: { run, select, update, all, delete: del, insert }
    })

    await migrator.prepare(migrationContext)
    await migrator.execute(migrationContext)
    await migrator.validate(migrationContext)

    expect(resolvePath).toHaveBeenCalledTimes(1)
  })

  it('validate attaches the legacy db to compare against expected filtered counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const run = vi.fn().mockResolvedValue(undefined)
    const all = vi.fn().mockResolvedValue([{ count: 1 }])

    await migrator.prepare(createMigrationContext())
    await migrator.validate(createMigrationContext({ db: { run, all } }))

    expect(getExecutedSql(run)[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(getExecutedSql(run).at(-1)).toBe('DETACH DATABASE agents_legacy')
  })
})
