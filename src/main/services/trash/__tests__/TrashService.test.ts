import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, assistantDataService, topicService } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  assistantDataService: { delete: vi.fn() },
  topicService: {
    deleteByAssistantId: vi.fn(),
    deleteByIds: vi.fn(),
    listActiveIdsByAssistant: vi.fn()
  }
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/AssistantService', () => ({ assistantDataService }))
vi.mock('@data/services/TopicService', () => ({ topicService }))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {}
  return { ...actual, BaseService: MockBaseService }
})

// Keep the wiring test lean: the handler's own behavior is covered by
// trashPurgeJobHandler.test.ts — here only its identity matters.
vi.mock('../trashPurgeJobHandler', () => ({
  trashPurgeJobHandler: { recovery: 'singleton', defaultConcurrency: 1, execute: vi.fn() }
}))

const { trashPurgeJobHandler } = await import('../trashPurgeJobHandler')
const { TrashService } = await import('../TrashService')

const jobManager = {
  registerHandler: vi.fn(),
  getJobSchedule: vi.fn(() => null as unknown),
  registerJobSchedule: vi.fn(() => ({ id: 'schedule-1' })),
  enqueue: vi.fn()
}
const busyTopicIds = new Set<string>()
const aiStreamManager = {
  hasUnsettledTopicWork: vi.fn((topicId: string) => busyTopicIds.has(topicId)),
  withDispatchLock: vi.fn(async (_topicId: string, operation: () => Promise<unknown>) => operation())
}

beforeEach(() => {
  vi.clearAllMocks()
  busyTopicIds.clear()
  jobManager.getJobSchedule.mockReturnValue(null)
  topicService.listActiveIdsByAssistant.mockReturnValue([])
  appGetMock.mockImplementation((name: string) => {
    if (name === 'JobManager') return jobManager
    if (name === 'AiStreamManager') return aiStreamManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// Lifecycle hooks are protected — the container is not running in tests, so
// drive them via the `any` escape hatch.
const drive = (svc: InstanceType<typeof TrashService>) => svc as unknown as { onInit(): void; onReady(): void }

describe('TrashService', () => {
  it('declares WhenReady phase with same-phase deps only (no BeforeReady services)', () => {
    expect(getPhase(TrashService)).toBe(Phase.WhenReady)
    expect(getDependencies(TrashService)).toEqual(['JobManager', 'FileManager', 'AiStreamManager'])
  })

  it('registers the trash.purge handler in onInit so startup recovery sees it', () => {
    drive(new TrashService()).onInit()

    expect(jobManager.registerHandler).toHaveBeenCalledExactlyOnceWith('trash.purge', trashPurgeJobHandler)
  })

  it('registers the daily schedule on first boot and never again once one exists', () => {
    // First boot: no persisted schedule → register.
    const first = drive(new TrashService())
    first.onInit()
    first.onReady()

    expect(jobManager.registerJobSchedule).toHaveBeenCalledExactlyOnceWith({
      type: 'trash.purge',
      trigger: { kind: 'cron', expr: '0 3 * * *' },
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'after-startup', minutes: 3 }
    })

    // Simulated second boot: the schedule row persisted → getJobSchedule
    // returns a snapshot and registerJobSchedule must NOT insert another row.
    jobManager.registerJobSchedule.mockClear()
    jobManager.getJobSchedule.mockReturnValue({ id: 'schedule-1', type: 'trash.purge' })
    const second = drive(new TrashService())
    second.onInit()
    second.onReady()

    expect(jobManager.registerJobSchedule).not.toHaveBeenCalled()
  })

  it('purgeNow enqueues an emptyAll run and resolves with the terminal status', async () => {
    jobManager.enqueue.mockReturnValue({
      id: 'job-1',
      snapshot: { id: 'job-1', status: 'pending' },
      finished: Promise.resolve({ id: 'job-1', status: 'completed', output: { reclaimed: true } })
    })

    const result = await new TrashService().purgeNow()

    expect(jobManager.enqueue).toHaveBeenCalledExactlyOnceWith('trash.purge', { emptyAll: true })
    expect(result).toEqual({ status: 'completed', reclaimed: true })
  })

  it('purgeNow passes a failed terminal status through instead of masking it', async () => {
    jobManager.enqueue.mockReturnValue({
      id: 'job-2',
      snapshot: { id: 'job-2', status: 'pending' },
      finished: Promise.resolve({ id: 'job-2', status: 'failed' })
    })

    // A failed run reports no reclamation — the caller must not promise the space back.
    await expect(new TrashService().purgeNow()).resolves.toEqual({ status: 'failed', reclaimed: false })
  })

  it('rejects an entire Topic archive batch when one Topic has unsettled work', async () => {
    busyTopicIds.add('topic-b')

    await expect(new TrashService().archiveTopics(['topic-b', 'topic-a'])).rejects.toEqual(
      expect.objectContaining({
        name: 'TopicArchiveBusyError',
        topicIds: ['topic-b']
      })
    )

    expect(topicService.deleteByIds).not.toHaveBeenCalled()
  })

  it('does not archive an Assistant when a cascading Topic is unsettled', async () => {
    topicService.listActiveIdsByAssistant.mockReturnValue(['topic-a'])
    busyTopicIds.add('topic-a')

    await expect(new TrashService().archiveAssistant('assistant-a', true)).rejects.toMatchObject({
      name: 'TopicArchiveBusyError',
      topicIds: ['topic-a']
    })

    expect(assistantDataService.delete).not.toHaveBeenCalled()
  })

  it('rechecks Assistant Topic membership after locking before archiving', async () => {
    topicService.listActiveIdsByAssistant
      .mockReturnValueOnce(['topic-a'])
      .mockReturnValueOnce(['topic-a', 'topic-b'])
      .mockReturnValue(['topic-a', 'topic-b'])
    topicService.deleteByAssistantId.mockReturnValue({
      deletedIds: ['topic-a', 'topic-b'],
      deletedCount: 2
    })

    await expect(new TrashService().archiveAssistantTopics('assistant-a')).resolves.toEqual({
      deletedIds: ['topic-a', 'topic-b'],
      deletedCount: 2
    })

    expect(topicService.deleteByAssistantId).toHaveBeenCalledExactlyOnceWith('assistant-a')
    expect(aiStreamManager.withDispatchLock.mock.calls.map(([topicId]) => topicId)).toEqual([
      'topic-a',
      'topic-a',
      'topic-b'
    ])
  })

  it('archives an Assistant without touching Topic runtime when related Topics are preserved', async () => {
    assistantDataService.delete.mockReturnValue({ deleted: true })

    await expect(new TrashService().archiveAssistant('assistant-a', false)).resolves.toEqual({ deleted: true })

    expect(assistantDataService.delete).toHaveBeenCalledExactlyOnceWith('assistant-a')
    expect(topicService.listActiveIdsByAssistant).not.toHaveBeenCalled()
    expect(aiStreamManager.hasUnsettledTopicWork).not.toHaveBeenCalled()
  })
})
