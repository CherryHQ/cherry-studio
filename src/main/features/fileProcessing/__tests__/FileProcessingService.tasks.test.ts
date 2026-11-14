/**
 * Task-model tests for FileProcessingService against a real JobManager and a
 * file-backed DB: the states a task goes through and how they are reported,
 * cancellation, and what a launch does with the previous launch's tasks. The
 * processor is stubbed; processor suites cover conversion itself.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { jobTable } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type { FileProcessingTask } from '@shared/data/types/fileProcessing'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { FileProcessingExecutionContext } from '../processors/types'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

interface Conversion {
  context: FileProcessingExecutionContext
  finish(text: string): void
  fail(error: Error): void
}

const { conversions, prepareMock } = vi.hoisted(() => {
  const conversions: Conversion[] = []
  const runConversion = (context: FileProcessingExecutionContext) =>
    new Promise((resolve, reject) => {
      conversions.push({ context, finish: (text) => resolve({ kind: 'text', text }), fail: reject })
      context.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
        once: true
      })
    })
  return {
    conversions,
    prepareMock: vi.fn(() => ({ mode: 'background' as const, execute: runConversion }))
  }
})

vi.mock('../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: () => ({
    id: 'tesseract',
    capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
  }),
  getFileProcessorConfigById: vi.fn()
}))

vi.mock('../processors/registry', () => ({
  processorRegistry: {
    tesseract: {
      runtime: 'local',
      capabilities: { image_to_text: { mode: 'background', prepare: prepareMock } },
      isSupported: () => true
    }
  }
}))

const { FileProcessingService } = await import('../FileProcessingService')

describe('FileProcessingService tasks', () => {
  const dbh = setupTestDatabase()
  let tempDir: string
  let imagePath: AbsoluteFilePath
  let scheduler: SchedulerService
  let jobManager: JobManager
  let service: InstanceType<typeof FileProcessingService>
  let events: FileProcessingTask[]

  async function launch(): Promise<void> {
    BaseService.resetInstances()
    scheduler = new SchedulerService()
    jobManager = new JobManager()
    service = new FileProcessingService()
    const dbSvc = MockMainDbServiceExport.dbService
    dbSvc.withWriteTx.mockImplementation(<T>(fn: (tx: unknown) => T): T => dbh.db.transaction((tx) => fn(tx)))
    ;(application.get as ReturnType<typeof vi.fn<(...args: any[]) => any>>).mockImplementation((name: string) => {
      switch (name) {
        case 'DbService':
          return dbSvc
        case 'CacheService':
          return MockMainCacheServiceExport.cacheService
        case 'SchedulerService':
          return scheduler
        case 'JobManager':
          return jobManager
        case 'RuntimeActivityService':
          return { begin: () => ({ dispose: () => {} }) }
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })
    await scheduler._doInit()
    await jobManager._doInit()
    await service._doInit()
    events = []
    service.onDidChangeTask((task) => events.push(task))
  }

  async function startOcr() {
    return await service.startTask({ feature: 'image_to_text', file: { kind: 'path', path: imagePath } })
  }

  async function conversionStarted(count: number): Promise<Conversion> {
    await vi.waitFor(() => expect(conversions).toHaveLength(count))
    return conversions[count - 1]
  }

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-processing-tasks-'))
    imagePath = path.join(tempDir, 'scan.png') as AbsoluteFilePath
    fs.writeFileSync(imagePath, 'png')
  })

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    conversions.length = 0
    prepareMock.mockClear()
    MockMainCacheServiceUtils.resetMocks()
    await launch()
  })

  afterEach(async () => {
    // Stopping still dispatches a queued task into the slot it frees, so cancel those first.
    jobManager.cancelMany({ type: 'file-processing.background-local' }, 'test cleanup')
    await jobManager._doStop()
    await scheduler._doStop()
  })

  it('reports queued, processing with progress, then completed with its artifact', async () => {
    const { task, done } = await startOcr()
    expect(task).toMatchObject({ feature: 'image_to_text', processorId: 'tesseract', status: 'queued' })

    const conversion = await conversionStarted(1)
    conversion.context.reportProgress(40)
    expect(await service.getTask(task.id)).toMatchObject({ status: 'processing', progress: 40 })
    conversion.finish('recognized text')

    const artifact = { kind: 'text', format: 'plain', text: 'recognized text' }
    expect(await done).toMatchObject({ id: task.id, status: 'completed', artifact })
    expect(events.map(({ status, ...rest }) => ('progress' in rest ? `${status} ${rest.progress}` : status))).toEqual([
      'queued',
      'processing 0',
      'processing 40',
      'completed'
    ])
    expect(MockMainCacheServiceExport.cacheService.getShared(`file_processing.task.${task.id}`)).toMatchObject({
      status: 'completed',
      artifact
    })
  })

  it('keeps a task queued while an earlier task holds the processor', async () => {
    const first = await startOcr()
    await conversionStarted(1)

    const second = await startOcr()

    expect(await service.getTask(second.task.id)).toMatchObject({ status: 'queued' })
    expect(await service.getTask(first.task.id)).toMatchObject({ status: 'processing' })
  })

  it('reports a failed conversion with its message', async () => {
    const { task, done } = await startOcr()
    ;(await conversionStarted(1)).fail(new Error('engine crashed'))

    expect(await done).toMatchObject({ id: task.id, status: 'failed', error: 'engine crashed' })
    expect(events.at(-1)).toMatchObject({ status: 'failed', error: 'engine crashed' })
  })

  it('reads a settled task from its job once the cache entry expires', async () => {
    const { task, done } = await startOcr()
    ;(await conversionStarted(1)).finish('recognized text')
    await done

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 10 * 60_000 })
    try {
      expect(MockMainCacheServiceExport.cacheService.getShared(`file_processing.task.${task.id}`)).toBeUndefined()
      expect(await service.getTask(task.id)).toMatchObject({
        status: 'completed',
        artifact: { kind: 'text', text: 'recognized text' }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a queued task before its conversion starts', async () => {
    await startOcr()
    await conversionStarted(1)
    const { task, done } = await startOcr()

    expect(await service.cancelTask(task.id, 'user dismissed')).toBe('cancelled')

    expect(await done).toMatchObject({ status: 'cancelled', error: 'user dismissed' })
    expect(events.at(-1)).toMatchObject({ id: task.id, status: 'cancelled' })
    expect(conversions).toHaveLength(1)
  })

  it('cancels a processing task and stops its conversion', async () => {
    const { task, done } = await startOcr()
    const conversion = await conversionStarted(1)

    expect(await service.cancelTask(task.id, 'user dismissed')).toBe('cancelled')

    expect(conversion.context.signal.aborted).toBe(true)
    expect(await done).toMatchObject({ status: 'cancelled' })
    expect(await service.getTask(task.id)).toMatchObject({ status: 'cancelled' })
  })

  it('keeps a cancelled task cancelled when its conversion still reports progress', async () => {
    const { task, done } = await startOcr()
    const conversion = await conversionStarted(1)
    await service.cancelTask(task.id)
    await done

    conversion.context.reportProgress(80)

    expect(events.at(-1)).toMatchObject({ id: task.id, status: 'cancelled' })
    expect(MockMainCacheServiceExport.cacheService.getShared(`file_processing.task.${task.id}`)).toMatchObject({
      status: 'cancelled'
    })
  })

  it('does not treat another job as a task', async () => {
    jobManager.registerHandler('other.job' as never, { recovery: 'abandon', execute: async () => ({}) })
    const other = jobManager.enqueue('other.job' as never, {} as never)

    expect(await service.getTask(other.id as never)).toBeNull()
    expect(await service.cancelTask(other.id as never)).toBe('not-cancellable')
  })

  it('cancels every task the previous launch left unfinished, without converting it', async () => {
    await jobManager._doStop()
    await scheduler._doStop()
    const now = Date.now()
    const leftover = (type: string, status: 'pending' | 'running', processorId: string) => ({
      type,
      status,
      queue: `file-processing.${processorId}`,
      scheduledAt: now - 1000,
      ...(status === 'running' ? { startedAt: now - 500 } : {}),
      attempt: 0,
      maxAttempts: 1,
      input: { feature: 'image_to_text', file: { kind: 'path', path: imagePath }, processorId },
      cancelRequested: false,
      metadata: {}
    })
    await (MockMainDbServiceExport.dbService.getDb() as DbType)
      .insert(jobTable)
      .values([
        leftover('file-processing.background', 'running', 'mistral'),
        leftover('file-processing.background-local', 'pending', 'tesseract'),
        leftover('file-processing.remote-poll', 'running', 'doc2x')
      ])

    await launch()

    const rows = jobService.list({
      type: ['file-processing.background', 'file-processing.background-local', 'file-processing.remote-poll']
    })
    expect(rows.map((row) => row.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(conversions).toHaveLength(0)
  })
})
