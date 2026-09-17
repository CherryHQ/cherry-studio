import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { describe, expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'

/**
 * Regression guard for the heartbeat session-visibility backfill (0024).
 *
 * The backfill may only retype sessions a heartbeat run created. Keying on
 * the sentinel prompt alone would also hide a legacy user task whose prompt
 * happened to be exactly '__heartbeat__' — a real user session disappearing
 * from conversations. The shipped statement therefore additionally requires
 * the referencing fire's schedule template to carry the sentinel, which only
 * heartbeat schedules do.
 */

function readBackfillStatement(): string {
  const dir = resolveMigrationsPath()
  const file = readdirSync(dir).find((name) => /^0024_.*\.sql$/.test(name))
  if (!file) throw new Error('0024 agent session type migration not found')
  const statements = readFileSync(join(dir, file), 'utf-8')
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
  return statements[1]
}

describe('agent session type backfill (migration 0024)', () => {
  const dbh = setupTestDatabase()

  function seedRow(values: {
    id: string
    scheduleId: string | null
    prompt?: string
    sessionId: string
    schedulePrompt?: string
  }) {
    if (values.scheduleId && values.schedulePrompt) {
      dbh.db
        .insert(jobScheduleTable)
        .values({
          id: values.scheduleId,
          type: 'agent.task',
          name: `schedule-${values.scheduleId}`,
          trigger: { kind: 'interval', ms: 60_000 },
          jobInputTemplate: { agentId: 'agent', prompt: values.schedulePrompt },
          catchUpPolicy: { kind: 'skip-missed' },
          createdAt: 1,
          updatedAt: 1
        })
        .run()
    }
    dbh.db
      .insert(jobTable)
      .values({
        id: `job-${values.id}`,
        type: 'agent.task',
        status: 'completed',
        queue: 'agent:agent',
        scheduleId: values.scheduleId,
        scheduledAt: 1,
        input: values.prompt === undefined ? { agentId: 'agent' } : { agentId: 'agent', prompt: values.prompt },
        metadata: { sessionId: values.sessionId },
        createdAt: 1,
        updatedAt: 1
      })
      .run()
  }

  function seedSessions(ids: string[]) {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'ws-1', name: 'ws-1', path: '/tmp/ws-1', type: 'user', orderKey: 'w0' })
      .run()
    for (const [index, id] of ids.entries()) {
      dbh.db
        .insert(agentSessionTable)
        .values({ id, name: id, workspaceId: 'ws-1', orderKey: `a${index}` })
        .run()
    }
  }

  function typeOf(id: string): string {
    return (dbh.sqlite.prepare('SELECT type FROM agent_session WHERE id = ?').get(id) as { type: string }).type
  }

  it('retypes sessions a heartbeat schedule fire created', () => {
    seedSessions(['sess-hb', 'sess-untouched'])
    seedRow({
      id: 'hb',
      scheduleId: 'sched-hb',
      prompt: '__heartbeat__',
      sessionId: 'sess-hb',
      schedulePrompt: '__heartbeat__'
    })

    dbh.sqlite.exec(readBackfillStatement())

    expect(typeOf('sess-hb')).toBe('background')
    expect(typeOf('sess-untouched')).toBe('conversation')
  })

  it('keeps sessions a user task touched, including a sentinel-prompted legacy task', () => {
    seedSessions(['sess-user-sentinel', 'sess-mixed', 'sess-noprompt'])
    // A legacy user task with the sentinel prompt but no heartbeat schedule must stay visible.
    seedRow({ id: 'user-sentinel', scheduleId: null, prompt: '__heartbeat__', sessionId: 'sess-user-sentinel' })
    // A session shared by a heartbeat fire and a real user task stays a conversation.
    seedRow({
      id: 'hb-shared',
      scheduleId: 'sched-hb',
      prompt: '__heartbeat__',
      sessionId: 'sess-mixed',
      schedulePrompt: '__heartbeat__'
    })
    seedRow({
      id: 'user-shared',
      scheduleId: 'sched-task',
      prompt: 'summarize the project',
      sessionId: 'sess-mixed',
      schedulePrompt: 'summarize the project'
    })
    // A promptless user job is not a heartbeat either.
    seedRow({ id: 'user-noprompt', scheduleId: null, sessionId: 'sess-noprompt' })

    dbh.sqlite.exec(readBackfillStatement())

    expect(typeOf('sess-user-sentinel')).toBe('conversation')
    expect(typeOf('sess-mixed')).toBe('conversation')
    expect(typeOf('sess-noprompt')).toBe('conversation')
  })
})
