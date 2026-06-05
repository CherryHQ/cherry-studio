/**
 * Focused test for `AgentsMigrator.migrateScheduledTasksTs` (the TS-loop that
 * replaces the legacy SQL importStatement-driven migration of v1
 * `scheduled_tasks`, `task_run_logs`, and `channel_task_subscriptions`).
 *
 * The full `migrator.execute()` path requires a fully-populated legacy DB
 * (every importStatement source table) and is exercised by the smoke test
 * and Phase 5 manual e2e. Here we ATTACH a minimal v1 DB directly to the
 * target connection and invoke the TS-loop in isolation, asserting:
 *   - jobScheduleTable rows = N (v1 task count, NOT counting run logs)
 *   - trigger encoding is correct per discriminant
 *   - jobInputTemplate carries agent_id / prompt / timeoutMinutes verbatim
 *   - jobTable stays at 0 rows (run logs are discarded)
 *   - agent_channel_task points at the new schedule.id via idMap
 *   - retry-friendly: a second invocation against the same legacy data
 *     produces the same row counts (no UNIQUE collisions).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { createClient } from '@libsql/client'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AgentsMigrator } from '../AgentsMigrator'

const AGENT_ID = 'agent-v1-001'
const CHANNEL_ID = 'channel-v1-001'

async function seedLegacyDb(path: string): Promise<void> {
  const client = createClient({ url: pathToFileURL(path).href })
  try {
    await client.execute(`
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        timeout_minutes INTEGER,
        status TEXT NOT NULL,
        next_run TEXT,
        last_run TEXT,
        last_result TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await client.execute(`
      CREATE TABLE task_run_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        session_id TEXT,
        run_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT
      )
    `)

    await client.execute(`
      CREATE TABLE channel_task_subscriptions (
        channel_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, task_id)
      )
    `)

    await client.execute({
      sql: `INSERT INTO scheduled_tasks (id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['task-cron', AGENT_ID, 'Daily standup', 'Run standup', 'cron', '0 9 * * *', 5, 'active']
    })
    await client.execute({
      sql: `INSERT INTO scheduled_tasks (id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['task-interval', AGENT_ID, 'Hourly ping', 'Ping', 'interval', '60', null, 'paused']
    })
    await client.execute({
      sql: `INSERT INTO scheduled_tasks (id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['task-once', AGENT_ID, 'One-off', 'Run once', 'once', '2026-05-20T12:00:00.000Z', 2, 'active']
    })

    // Two run-log rows that MUST be discarded by the migration.
    await client.execute({
      sql: `INSERT INTO task_run_logs (id, task_id, session_id, run_at, duration_ms, status, result, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['log-1', 'task-cron', null, '2026-05-19T09:00:00.000Z', 1234, 'success', 'ok', null]
    })
    await client.execute({
      sql: `INSERT INTO task_run_logs (id, task_id, session_id, run_at, duration_ms, status, result, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['log-2', 'task-interval', null, '2026-05-19T10:00:00.000Z', 567, 'error', null, 'boom']
    })

    // Two subscriptions — one pointing at a task that survives the migration,
    // one pointing at a task whose agent does NOT exist in target → migrator
    // must skip the dangling row instead of FK-failing.
    await client.execute({
      sql: `INSERT INTO channel_task_subscriptions (channel_id, task_id) VALUES (?, ?)`,
      args: [CHANNEL_ID, 'task-cron']
    })
    await client.execute({
      sql: `INSERT INTO channel_task_subscriptions (channel_id, task_id) VALUES (?, ?)`,
      args: [CHANNEL_ID, 'orphan-task']
    })
  } finally {
    client.close()
  }
}

describe('AgentsMigrator > migrateScheduledTasksTs', () => {
  const dbh = setupTestDatabase()
  let tempDir: string
  let legacyPath: string

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-agents-task-test-'))
    legacyPath = join(tempDir, 'agents.db')
    await seedLegacyDb(legacyPath)
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    // Seed parent rows in the target DB so the TS-loop's FK filter
    // (agent_id IN (SELECT id FROM agent)) keeps our tasks.
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'V1 Agent',
      instructions: 'helper',
      model: null,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentChannelTable).values({
      id: CHANNEL_ID,
      type: 'telegram',
      name: 'TG channel',
      agentId: AGENT_ID,
      config: { bot_token: 'x', allowed_chat_ids: [] },
      isActive: true
    })
  })

  /** Helper: ATTACH the legacy DB to the target connection, run the TS-loop,
   *  then DETACH. Encapsulates the surrounding scaffolding so each test
   *  only deals with assertions. */
  async function runTsLoop(): Promise<void> {
    await dbh.db.run(sql.raw(`ATTACH DATABASE '${legacyPath}' AS agents_legacy`))
    try {
      const migrator = new AgentsMigrator()
      await (
        migrator as unknown as { migrateScheduledTasksTs: (db: typeof dbh.db) => Promise<void> }
      ).migrateScheduledTasksTs(dbh.db)
    } finally {
      await dbh.db.run(sql.raw('DETACH DATABASE agents_legacy'))
    }
  }

  it('migrates v1 scheduled_tasks into jobScheduleTable with correct trigger encoding', async () => {
    await runTsLoop()

    const schedules = await dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.type, 'agent.task'))

    expect(schedules).toHaveLength(3)

    const byTrigger = new Map(schedules.map((s) => [(s.trigger as { kind: string }).kind, s]))
    const cronRow = byTrigger.get('cron')
    const intervalRow = byTrigger.get('interval')
    const onceRow = byTrigger.get('once')

    expect(cronRow?.trigger).toEqual({ kind: 'cron', expr: '0 9 * * *' })
    expect(intervalRow?.trigger).toEqual({ kind: 'interval', ms: 60 * 60_000 })
    expect(onceRow?.trigger).toEqual({ kind: 'once', at: Date.parse('2026-05-20T12:00:00.000Z') })
  })

  it('carries agent_id / prompt / timeoutMinutes into jobInputTemplate verbatim', async () => {
    await runTsLoop()

    const cron = await dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.name, 'Daily standup')).limit(1)
    expect(cron[0]?.jobInputTemplate).toEqual({
      agentId: AGENT_ID,
      prompt: 'Run standup',
      timeoutMinutes: 5
    })

    const interval = await dbh.db
      .select()
      .from(jobScheduleTable)
      .where(eq(jobScheduleTable.name, 'Hourly ping'))
      .limit(1)
    // legacy task with NULL timeout falls back to 2 (matches v1 default).
    expect(interval[0]?.jobInputTemplate).toEqual({
      agentId: AGENT_ID,
      prompt: 'Ping',
      timeoutMinutes: 2
    })
  })

  it('reflects v1 status in the enabled flag (paused → false)', async () => {
    await runTsLoop()

    const rows = await dbh.db
      .select({ name: jobScheduleTable.name, enabled: jobScheduleTable.enabled })
      .from(jobScheduleTable)
      .where(eq(jobScheduleTable.type, 'agent.task'))
    const byName = new Map(rows.map((r) => [r.name, r.enabled]))
    expect(byName.get('Daily standup')).toBe(true)
    expect(byName.get('Hourly ping')).toBe(false)
    expect(byName.get('One-off')).toBe(true)
  })

  it('discards v1 run logs — jobTable remains empty', async () => {
    await runTsLoop()

    const jobs = await dbh.db.select().from(jobTable)
    expect(jobs).toHaveLength(0)
  })

  it('inserts agent_channel_task rows pointing at the new schedule.id (idMap relink)', async () => {
    await runTsLoop()

    const cron = await dbh.db
      .select({ id: jobScheduleTable.id })
      .from(jobScheduleTable)
      .where(eq(jobScheduleTable.name, 'Daily standup'))
      .limit(1)
    const newScheduleId = cron[0]?.id

    const links = await dbh.db.select().from(agentChannelTaskTable)
    // Only one subscription survives — the orphan-task row is dropped because
    // its task isn't in legacy.scheduled_tasks (the filter pulls only rows
    // whose task_id and channel_id both resolve).
    expect(links).toHaveLength(1)
    expect(links[0]?.channelId).toBe(CHANNEL_ID)
    expect(links[0]?.taskId).toBe(newScheduleId)
  })

  it('is retry-safe: a second invocation produces the same target state', async () => {
    await runTsLoop()
    await runTsLoop()

    const schedules = await dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.type, 'agent.task'))
    expect(schedules).toHaveLength(3)
  })
})

describe('AgentsMigrator > migrateScheduledTasksTs > duplicate v1 task names', () => {
  const dbh = setupTestDatabase()
  let tempDir: string
  let legacyPath: string

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-agents-task-dup-test-'))
    legacyPath = join(tempDir, 'agents.db')
    const client = createClient({ url: pathToFileURL(legacyPath).href })
    try {
      await client.execute(`
        CREATE TABLE scheduled_tasks (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          schedule_type TEXT NOT NULL,
          schedule_value TEXT NOT NULL,
          timeout_minutes INTEGER,
          status TEXT NOT NULL
        )
      `)
      await client.execute(`
        CREATE TABLE channel_task_subscriptions (
          channel_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          PRIMARY KEY (channel_id, task_id)
        )
      `)
      // Two distinct v1 tasks sharing the SAME name. Both map to
      // (type='agent.task', name='Daily standup') and would collide on the
      // unique index unless the migrator disambiguates.
      await client.execute({
        sql: `INSERT INTO scheduled_tasks (id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ['task-dup-1', AGENT_ID, 'Daily standup', 'Run standup A', 'cron', '0 9 * * *', 5, 'active']
      })
      await client.execute({
        sql: `INSERT INTO scheduled_tasks (id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ['task-dup-2', AGENT_ID, 'Daily standup', 'Run standup B', 'cron', '0 10 * * *', 5, 'active']
      })
    } finally {
      client.close()
    }
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'V1 Agent',
      instructions: 'helper',
      model: null,
      orderKey: 'a0'
    })
  })

  it('migrates both same-named v1 tasks without throwing, disambiguating one name', async () => {
    await dbh.db.run(sql.raw(`ATTACH DATABASE '${legacyPath}' AS agents_legacy`))
    try {
      const migrator = new AgentsMigrator()
      await expect(
        (
          migrator as unknown as { migrateScheduledTasksTs: (db: typeof dbh.db) => Promise<void> }
        ).migrateScheduledTasksTs(dbh.db)
      ).resolves.toBeUndefined()
    } finally {
      await dbh.db.run(sql.raw('DETACH DATABASE agents_legacy'))
    }

    const schedules = await dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.type, 'agent.task'))
    // Both v1 tasks survive — no row dropped, no UNIQUE abort.
    expect(schedules).toHaveLength(2)

    // Names are unique: one keeps 'Daily standup', the other falls back to a
    // disambiguated `task_<id>` form.
    const names = schedules.map((s) => s.name).sort()
    expect(new Set(names).size).toBe(2)
    expect(names).toContain('Daily standup')
    expect(names.some((n) => n.startsWith('task_task-dup-'))).toBe(true)
  })
})
