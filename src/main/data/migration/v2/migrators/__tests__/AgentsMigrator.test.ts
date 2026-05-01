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

import { LegacyAgentsDbReader } from '../../utils/LegacyAgentsDbReader'
import { AgentsMigrator } from '../AgentsMigrator'
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
    expect(result.itemCount).toBe(45)
  })

  it('execute attaches the legacy db and imports every table inside a FK-off transaction', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    // remapAgentPrefixIds calls db.select().from().where() to find old-prefix IDs;
    // mock to return empty arrays so the remap loop is a no-op.
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
    // remapAgentPrefixIds runs PRAGMA foreign_key_check via db.all; empty => no FK violations.
    const all = vi.fn().mockResolvedValue([])

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    const result = await migrator.execute(createMigrationContext({ db: { run, select, update, all } }))

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(45)

    const outer = getExecutedSql(run)
    // Import phase: ATTACH → PRAGMA FK OFF → BEGIN → [INSERTs] → COMMIT
    expect(outer[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(outer[1]).toBe('PRAGMA foreign_keys = OFF')
    expect(outer[2]).toBe('BEGIN')
    // After import COMMIT: remapAgentPrefixIds emits PRAGMA FK OFF → BEGIN → COMMIT → PRAGMA FK ON
    // Then execute() finally emits PRAGMA FK ON → DETACH
    // run tail: ...COMMIT(import), PRAGMA FK OFF, BEGIN, COMMIT, PRAGMA FK ON, PRAGMA FK ON, DETACH
    expect(outer.at(-7)).toBe('COMMIT')
    expect(outer.at(-6)).toBe('PRAGMA foreign_keys = OFF')
    expect(outer.at(-5)).toBe('BEGIN')
    expect(outer.at(-4)).toBe('COMMIT')
    expect(outer.at(-3)).toBe('PRAGMA foreign_keys = ON')
    expect(outer.at(-2)).toBe('PRAGMA foreign_keys = ON')
    expect(outer.at(-1)).toBe('DETACH DATABASE agents_legacy')
    // INSERT statements sit between the initial BEGIN and the main COMMIT
    const insertCalls = outer.slice(3, -7)
    expect(insertCalls).toHaveLength(AGENTS_TABLE_MIGRATION_SPECS.length)
    // No old-prefix IDs returned → no UPDATE calls
    expect(update).not.toHaveBeenCalled()
  })

  it('re-enables FK and detaches when an import statement fails inside the transaction', async () => {
    // First 3 calls succeed (ATTACH, FK_OFF, BEGIN), 4th (first INSERT) fails
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined) // ATTACH
      .mockResolvedValueOnce(undefined) // PRAGMA foreign_keys = OFF
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('insert failed')) // first INSERT fails
      .mockResolvedValue(undefined) // ROLLBACK, FK_ON, DETACH

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    await expect(migrator.execute(createMigrationContext({ db: { run } }))).rejects.toThrow('insert failed')

    const executed = getExecutedSql(run)
    expect(executed).toContain('ROLLBACK')
    expect(executed).toContain('PRAGMA foreign_keys = ON')
    expect(executed.at(-1)).toBe('DETACH DATABASE agents_legacy')
    expect(executed.some((stmt) => stmt?.startsWith('DELETE FROM agent'))).toBe(false)
  })

  it('validate fails when imported table counts are lower than the expected filtered counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const get = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 }) // agent target (expected 1 → mismatch)
      .mockResolvedValueOnce({ count: 1 }) // agent expected
      .mockResolvedValueOnce({ count: 2 }) // agent_session target
      .mockResolvedValueOnce({ count: 2 }) // agent_session expected
      .mockResolvedValueOnce({ count: 3 }) // agent_global_skill target
      .mockResolvedValueOnce({ count: 3 }) // agent_global_skill expected
      .mockResolvedValueOnce({ count: 4 }) // agent_skill target
      .mockResolvedValueOnce({ count: 4 }) // agent_skill expected
      .mockResolvedValueOnce({ count: 5 }) // agent_task target
      .mockResolvedValueOnce({ count: 5 }) // agent_task expected
      .mockResolvedValueOnce({ count: 6 }) // agent_task_run_log target
      .mockResolvedValueOnce({ count: 6 }) // agent_task_run_log expected
      .mockResolvedValueOnce({ count: 6 }) // agent_channel target (expected 7 → mismatch)
      .mockResolvedValueOnce({ count: 7 }) // agent_channel expected
      .mockResolvedValueOnce({ count: 8 }) // agent_channel_task target
      .mockResolvedValueOnce({ count: 8 }) // agent_channel_task expected
      .mockResolvedValueOnce({ count: 9 }) // agent_session_message target
      .mockResolvedValueOnce({ count: 9 }) // agent_session_message expected

    const run = vi.fn().mockResolvedValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { get, run } }))

    expect(result.success).toBe(false)
    expect(result.errors.map((error) => error.key)).toEqual(['agent_count_mismatch', 'agent_channel_count_mismatch'])
    expect(result.stats.sourceCount).toBe(45)
    expect(result.stats.targetCount).toBe(43)
  })

  it('validate flags target tables whose row count exceeds the expected filtered count', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const get = vi
      .fn()
      .mockResolvedValueOnce({ count: 2 }) // agent target (expected 1 → too high)
      .mockResolvedValueOnce({ count: 1 }) // agent expected
      .mockResolvedValueOnce({ count: 2 }) // agent_session target
      .mockResolvedValueOnce({ count: 2 }) // agent_session expected
      .mockResolvedValueOnce({ count: 3 }) // agent_global_skill target
      .mockResolvedValueOnce({ count: 3 }) // agent_global_skill expected
      .mockResolvedValueOnce({ count: 4 }) // agent_skill target
      .mockResolvedValueOnce({ count: 4 }) // agent_skill expected
      .mockResolvedValueOnce({ count: 5 }) // agent_task target
      .mockResolvedValueOnce({ count: 5 }) // agent_task expected
      .mockResolvedValueOnce({ count: 6 }) // agent_task_run_log target
      .mockResolvedValueOnce({ count: 6 }) // agent_task_run_log expected
      .mockResolvedValueOnce({ count: 7 }) // agent_channel target
      .mockResolvedValueOnce({ count: 7 }) // agent_channel expected
      .mockResolvedValueOnce({ count: 8 }) // agent_channel_task target
      .mockResolvedValueOnce({ count: 8 }) // agent_channel_task expected
      .mockResolvedValueOnce({ count: 9 }) // agent_session_message target
      .mockResolvedValueOnce({ count: 9 }) // agent_session_message expected

    const run = vi.fn().mockResolvedValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { get, run } }))

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
    const get = vi.fn().mockResolvedValue({ count: 8 })
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
    const all = vi.fn().mockResolvedValue([])
    const migrationContext = createMigrationContext({ db: { run, get, select, update, all } })

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
    const get = vi.fn().mockResolvedValue({ count: 1 })

    await migrator.prepare(createMigrationContext())
    await migrator.validate(createMigrationContext({ db: { run, get } }))

    expect(getExecutedSql(run)[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(getExecutedSql(run).at(-1)).toBe('DETACH DATABASE agents_legacy')
  })
})
