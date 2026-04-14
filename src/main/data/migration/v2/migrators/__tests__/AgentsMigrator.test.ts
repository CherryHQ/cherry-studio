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
    scheduled_tasks: 4,
    task_run_logs: 5,
    channels: 6,
    channel_task_subscriptions: 7,
    session_messages: 8
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
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const result = await migrator.prepare(createMigrationContext())

    expect(result.success).toBe(true)
    expect(result.itemCount).toBe(36)
  })

  it('execute attaches the legacy db and imports every table', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const result = await migrator.execute(createMigrationContext({ db: { run } }))

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(36)
    expect(run).toHaveBeenCalledTimes(10)
  })

  it('detaches the legacy db when an import statement fails after attach', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce(undefined)

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await expect(migrator.execute(createMigrationContext({ db: { run } }))).rejects.toThrow('insert failed')
    expect(run).toHaveBeenLastCalledWith(expect.anything())
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('validate fails when imported table counts are lower than the source counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const get = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValueOnce({ count: 6 })
      .mockResolvedValueOnce({ count: 7 })
      .mockResolvedValueOnce({ count: 8 })

    const result = await migrator.validate(createMigrationContext({ db: { get } }))

    expect(result.success).toBe(false)
    expect(result.errors[0]?.key).toBe('agents_sessions_count_mismatch')
    expect(result.stats.sourceCount).toBe(36)
    expect(result.stats.targetCount).toBe(35)
  })

  it('resolves the legacy db path once and reuses it across phases', async () => {
    const resolvePath = vi
      .spyOn(LegacyAgentsDbReader.prototype, 'resolvePath')
      .mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const run = vi.fn().mockResolvedValue(undefined)
    const get = vi.fn().mockResolvedValue({ count: 8 })
    const migrationContext = createMigrationContext({ db: { run, get } })

    await migrator.prepare(migrationContext)
    await migrator.execute(migrationContext)
    await migrator.validate(migrationContext)

    expect(resolvePath).toHaveBeenCalledTimes(1)
  })
})
