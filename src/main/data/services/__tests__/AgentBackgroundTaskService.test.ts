import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentBackgroundTaskService } from '@data/services/AgentBackgroundTaskService'
import type { BackgroundTaskRecord } from '@shared/ai/backgroundTask'

describe('AgentBackgroundTaskService.saveRecords', () => {
  const dbh = setupTestDatabase()

  /** Insert a minimal agent row directly so agentId FK constraints are satisfied. */
  async function insertAgent(id: string): Promise<void> {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name: `Agent ${id}`,
      instructions: 'test',
      model: null,
      orderKey: 'a0'
    })
  }

  function taskRecord(id: string, startedAt: string): BackgroundTaskRecord {
    return {
      id,
      name: id,
      command: 'true',
      pid: 123,
      cwd: '/tmp',
      startedAt,
      logFile: `/tmp/${id}.log`,
      status: 'completed',
      exitCode: 0,
      signal: null
    }
  }

  it('sweeps index rows whose disk records are gone', async () => {
    await insertAgent('agent-1')
    agentBackgroundTaskService.saveRecords('agent-1', [
      taskRecord('bt-a', '2026-01-01T00:00:01.000Z'),
      taskRecord('bt-b', '2026-01-01T00:00:02.000Z')
    ])
    expect(agentBackgroundTaskService.listByAgent('agent-1').map((task) => task.id)).toEqual(['bt-b', 'bt-a'])

    // bt-a's JSON record vanished from disk; the panel's next snapshot indexes only bt-b, so the
    // stale row must not keep serving a task no control path can find.
    agentBackgroundTaskService.saveRecords('agent-1', [taskRecord('bt-b', '2026-01-01T00:00:02.000Z')])
    expect(agentBackgroundTaskService.listByAgent('agent-1').map((task) => task.id)).toEqual(['bt-b'])
  })

  it('sweeps every row when the disk snapshot is empty', async () => {
    await insertAgent('agent-2')
    agentBackgroundTaskService.saveRecords('agent-2', [taskRecord('bt-c', '2026-01-01T00:00:01.000Z')])

    agentBackgroundTaskService.saveRecords('agent-2', [])

    expect(agentBackgroundTaskService.listByAgent('agent-2')).toEqual([])
  })

  it('leaves other agents indexed while sweeping one', async () => {
    await insertAgent('agent-3')
    await insertAgent('agent-4')
    agentBackgroundTaskService.saveRecords('agent-3', [taskRecord('bt-d', '2026-01-01T00:00:01.000Z')])
    agentBackgroundTaskService.saveRecords('agent-4', [taskRecord('bt-e', '2026-01-01T00:00:01.000Z')])

    agentBackgroundTaskService.saveRecords('agent-3', [])

    expect(agentBackgroundTaskService.listByAgent('agent-3')).toEqual([])
    expect(agentBackgroundTaskService.listByAgent('agent-4').map((task) => task.id)).toEqual(['bt-e'])
  })

  // A detached task can finish while backup or restore holds the writers to take a consistent
  // database fingerprint. A completion landing inside that window must not move the fingerprint:
  // the disk record and sentinel already carry the evidence, so the index write waits and is
  // replayed once the hold is released.
  it('defers index writes while backup holds them and replays them on release', async () => {
    await insertAgent('agent-5')
    agentBackgroundTaskService.saveRecords('agent-5', [taskRecord('bt-before', '2026-01-01T00:00:01.000Z')])
    expect(agentBackgroundTaskService.listByAgent('agent-5').map((task) => task.id)).toEqual(['bt-before'])

    const hold = agentBackgroundTaskService.pauseWrites('test: capture fingerprint')
    agentBackgroundTaskService.saveRecord('agent-5', taskRecord('bt-during', '2026-01-01T00:00:02.000Z'))

    // Nothing may be written while the fingerprint is being taken: a row here would change the
    // database the backup is about to hash.
    expect(agentBackgroundTaskService.listByAgent('agent-5').map((task) => task.id)).toEqual(['bt-before'])

    // Writes resume: the deferred completion is replayed against its agent.
    hold.dispose()
    expect(agentBackgroundTaskService.listByAgent('agent-5').map((task) => task.id)).toEqual(['bt-during', 'bt-before'])
  })

  it('does not replay another hold writes before every hold is released', async () => {
    await insertAgent('agent-6')
    const first = agentBackgroundTaskService.pauseWrites('test: hold one')
    const second = agentBackgroundTaskService.pauseWrites('test: hold two')
    agentBackgroundTaskService.saveRecord('agent-6', taskRecord('bt-hold', '2026-01-01T00:00:01.000Z'))

    first.dispose()
    expect(agentBackgroundTaskService.listByAgent('agent-6')).toEqual([])

    second.dispose()
    expect(agentBackgroundTaskService.listByAgent('agent-6').map((task) => task.id)).toEqual(['bt-hold'])
  })
})
