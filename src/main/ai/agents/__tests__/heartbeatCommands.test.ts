import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentService } from '@data/services/AgentService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'

vi.mock('../agentTaskJobHandler', () => ({
  agentTaskJobHandler: {
    recovery: 'retry',
    async execute() {
      return {}
    }
  }
}))
vi.mock('@main/i18n', () => ({ t: () => 'Heartbeat' }))

import { AgentJobsService } from '../AgentJobsService'

// Check real schedule/job persistence; runtime execution is covered by runAgentTask.visibility.
describe('heartbeat commands', () => {
  const dbh = setupTestDatabase()
  let service: AgentJobsService
  let manager: JobManager
  let scheduler: SchedulerService
  let root: string
  beforeEach(async () => {
    BaseService.resetInstances()
    root = await mkdtemp(path.join(tmpdir(), 'heartbeat-command-'))
    scheduler = new SchedulerService()
    manager = new JobManager()
    service = new AgentJobsService()
    vi.mocked(application.getPath).mockReturnValue(root)
    vi.mocked(application.get).mockImplementation(((name: string) => {
      switch (name) {
        case 'DbService':
          return MockMainDbServiceExport.dbService
        case 'CacheService':
          return MockMainCacheServiceExport.cacheService
        case 'SchedulerService':
          return scheduler
        case 'JobManager':
          return manager
        case 'AgentJobsService':
          return service
        default:
          throw new Error(`Unexpected service ${name}`)
      }
    }) as typeof application.get)
    await scheduler._doInit()
    await manager._doInit()
    await service._doInit()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'a1',
        name: 'Test',
        type: 'claude-code',
        instructions: '',
        orderKey: 'a0',
        configuration: { heartbeat_enabled: true }
      })
      .run()
  })
  afterEach(async () => {
    await service._doStop()
    await manager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
    await rm(root, { recursive: true, force: true })
  })

  it('persists a manual heartbeat job without moving the automatic schedule or exposing an ordinary task', async () => {
    const hold = manager.pause('inspect queued manual run')
    const doc = await service.readHeartbeatDocument('a1')
    await service.writeHeartbeatDocument('a1', { ...doc, content: '- Check status' })
    await service.syncHeartbeat('a1')
    const schedule = agentTaskService.getHeartbeatSchedule('a1')!
    expect(await service.runHeartbeat('a1')).toBe('started')
    const latest = agentTaskService.getHeartbeatStatus('a1').latestRun
    expect(latest).toMatchObject({
      scheduleId: schedule.id,
      status: 'pending',
      input: { agentId: 'a1', prompt: '__heartbeat__' }
    })
    expect(latest?.input).not.toHaveProperty('workspace')
    expect(agentTaskService.getHeartbeatSchedule('a1')?.nextRun).toBe(schedule.nextRun)
    expect(agentTaskService.listTasks('a1').tasks).toEqual([])
    expect(await service.runHeartbeat('a1')).toBe('busy')
    expect(jobService.list({ scheduleId: schedule.id })).toHaveLength(1)
    hold.dispose()
  })

  it('does not enqueue empty or disabled heartbeats', async () => {
    expect(await service.runHeartbeat('a1')).toBe('empty')
    agentService.updateAgent('a1', { configuration: { heartbeat_enabled: false } })
    expect(await service.runHeartbeat('a1')).toBe('disabled')
    expect(jobService.list()).toEqual([])
  })

  it('rejects editor mutations during backup quiescence', async () => {
    const doc = await service.readHeartbeatDocument('a1')
    const hold = service.pause('test backup')
    expect(() => service.writeHeartbeatDocument('a1', { ...doc, content: '- Changed' })).toThrow('paused')
    expect(() => service.runHeartbeat('a1')).toThrow('paused')
    hold.dispose()
    expect((await service.readHeartbeatDocument('a1')).content).toBe(doc.content)
  })
})
