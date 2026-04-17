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
      legacyAgentDbFallbackFile: '/mock/agents.db'
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

  it('execute attaches the legacy db and imports every table in a transaction', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    const result = await migrator.execute(createMigrationContext({ db: { run } }))

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(45)
    expect(getExecutedSql(run)).toContain('BEGIN IMMEDIATE')
    expect(getExecutedSql(run)).toContain('COMMIT')
    expect(run).toHaveBeenCalledTimes(13)
  })

  it('rolls back and clears target tables when an import statement fails after attach', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(undefined)

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    await expect(migrator.execute(createMigrationContext({ db: { run } }))).rejects.toThrow('insert failed')

    expect(getExecutedSql(run)).toContain('ROLLBACK')
    expect(getExecutedSql(run)).toContain('DELETE FROM agents_session_messages')
    expect(getExecutedSql(run).at(-1)).toBe('DETACH DATABASE agents_legacy')
  })

  it('validate fails when imported table counts are lower than the expected filtered counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const get = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 }) // agents_agents target (expected 1 → mismatch)
      .mockResolvedValueOnce({ count: 1 }) // agents_agents expected
      .mockResolvedValueOnce({ count: 2 }) // agents_sessions target
      .mockResolvedValueOnce({ count: 2 }) // agents_sessions expected
      .mockResolvedValueOnce({ count: 3 }) // agents_global_skills target
      .mockResolvedValueOnce({ count: 3 }) // agents_global_skills expected
      .mockResolvedValueOnce({ count: 4 }) // agents_agent_skills target
      .mockResolvedValueOnce({ count: 4 }) // agents_agent_skills expected
      .mockResolvedValueOnce({ count: 5 }) // agents_tasks target
      .mockResolvedValueOnce({ count: 5 }) // agents_tasks expected
      .mockResolvedValueOnce({ count: 6 }) // agents_task_run_logs target
      .mockResolvedValueOnce({ count: 6 }) // agents_task_run_logs expected
      .mockResolvedValueOnce({ count: 6 }) // agents_channels target (expected 7 → mismatch)
      .mockResolvedValueOnce({ count: 7 }) // agents_channels expected
      .mockResolvedValueOnce({ count: 8 }) // agents_channel_task_subscriptions target
      .mockResolvedValueOnce({ count: 8 }) // agents_channel_task_subscriptions expected
      .mockResolvedValueOnce({ count: 9 }) // agents_session_messages target
      .mockResolvedValueOnce({ count: 9 }) // agents_session_messages expected

    const run = vi.fn().mockResolvedValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { get, run } }))

    expect(result.success).toBe(false)
    expect(result.errors.map((error) => error.key)).toEqual([
      'agents_agents_count_mismatch',
      'agents_channels_count_mismatch'
    ])
    expect(result.stats.sourceCount).toBe(45)
    expect(result.stats.targetCount).toBe(43)
  })

  it('resolves the legacy db path once and reuses it across phases', async () => {
    const resolvePath = vi
      .spyOn(LegacyAgentsDbReader.prototype, 'resolvePath')
      .mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const run = vi.fn().mockResolvedValue(undefined)
    const get = vi.fn().mockResolvedValue({ count: 8 })
    const migrationContext = createMigrationContext({ db: { run, get } })

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
