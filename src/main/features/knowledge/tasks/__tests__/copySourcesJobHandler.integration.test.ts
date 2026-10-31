import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext } from '@main/core/job/types'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { AbsoluteFilePath } from '@shared/types/file'
import { KeyedMutex } from '@shared/utils/async'
import type { PosixRelativeFilePath } from '@shared/utils/file'

import type { KnowledgeItemScheduler } from '../../ingestion/KnowledgeIngestionService'
import type { KnowledgeCopySourcesPayload } from '../jobTypes'

// Real filesystem, real atomic copy, real lock: only the item row and the data root are stubbed.
const { dataRoot, getByIdMock, updateStatusMock } = vi.hoisted(() => ({
  dataRoot: { current: '' },
  getByIdMock: vi.fn(),
  updateStatusMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  mocked.application.getPath = vi.fn(() => dataRoot.current)
  return mocked
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: { getById: getByIdMock, updateStatus: updateStatusMock }
}))

const { createCopySourcesJobHandler } = await import('../copySourcesJobHandler')

const ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const RELATIVE_PATH = 'report.pdf' as PosixRelativeFilePath

function fileItem(status: 'preparing' | 'deleting' = 'preparing'): KnowledgeItemOf<'file'> {
  return {
    id: ITEM_ID,
    baseId: 'kb-1',
    groupId: null,
    type: 'file',
    data: { source: '/docs/report.pdf', relativePath: RELATIVE_PATH },
    status,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function ctxFor(input: KnowledgeCopySourcesPayload, signal = new AbortController().signal) {
  return {
    jobId: 'copy-job',
    input,
    attempt: 1,
    parentId: null,
    signal,
    metadata: {},
    patchMetadata: vi.fn(),
    reportProgress: vi.fn(),
    logger: {} as JobContext['logger']
  } as JobContext<KnowledgeCopySourcesPayload>
}

function listRawFiles(): string[] {
  const rawDir = path.join(dataRoot.current, 'kb-1', 'raw')
  return fs.existsSync(rawDir) ? fs.readdirSync(rawDir, { recursive: true }).map(String) : []
}

describe('copy-sources job handler on a real filesystem', () => {
  let sourcePath: AbsoluteFilePath
  let scheduler: KnowledgeItemScheduler

  beforeEach(() => {
    dataRoot.current = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-copy-sources-'))
    sourcePath = path.join(dataRoot.current, 'outside', 'report.pdf') as AbsoluteFilePath
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
    fs.writeFileSync(sourcePath, 'source bytes')
    getByIdMock.mockReset().mockReturnValue(fileItem())
    updateStatusMock.mockReset()
    scheduler = { scheduleItem: vi.fn(), scheduleIndexing: vi.fn() }
  })

  afterEach(() => {
    fs.rmSync(dataRoot.current, { recursive: true, force: true })
  })

  const payload = (): KnowledgeCopySourcesPayload => ({
    baseId: 'kb-1',
    itemId: ITEM_ID,
    copies: [{ from: sourcePath, relativePath: RELATIVE_PATH }]
  })

  it('lands the bytes at the reserved name with no temp file left behind', async () => {
    const handler = createCopySourcesJobHandler(new KeyedMutex(), scheduler)

    await handler.execute(ctxFor(payload()))

    expect(listRawFiles()).toEqual(['report.pdf'])
    expect(fs.readFileSync(path.join(dataRoot.current, 'kb-1', 'raw', 'report.pdf'), 'utf8')).toBe('source bytes')
    expect(updateStatusMock).toHaveBeenCalledWith(ITEM_ID, 'processing')
    expect(scheduler.scheduleItem).toHaveBeenCalledWith('kb-1', ITEM_ID)
  })

  it('leaves nothing under raw/ when the source is gone', async () => {
    fs.rmSync(sourcePath)
    const handler = createCopySourcesJobHandler(new KeyedMutex(), scheduler)

    await expect(handler.execute(ctxFor(payload()))).rejects.toThrow()

    expect(listRawFiles()).toEqual([])
    expect(updateStatusMock).not.toHaveBeenCalled()
    expect(scheduler.scheduleItem).not.toHaveBeenCalled()
  })

  it('leaves nothing under raw/ when the item is deleted before the commit', async () => {
    getByIdMock.mockReturnValueOnce(fileItem()).mockReturnValue(fileItem('deleting'))
    const handler = createCopySourcesJobHandler(new KeyedMutex(), scheduler)

    await handler.execute(ctxFor(payload()))

    expect(listRawFiles()).toEqual([])
    expect(scheduler.scheduleItem).not.toHaveBeenCalled()
  })

  it('leaves nothing under raw/ when a delete cancels the job while it waits for the lock', async () => {
    const lock = new KeyedMutex()
    const controller = new AbortController()
    const cancellingLock = {
      runExclusive: async <T>(key: string, task: () => T | Promise<T>) => {
        controller.abort(new Error('Job cancelled: knowledge-delete-subtree'))
        return await lock.runExclusive(key, task)
      }
    }
    const handler = createCopySourcesJobHandler(cancellingLock as unknown as KeyedMutex, scheduler)

    await expect(handler.execute(ctxFor(payload(), controller.signal))).rejects.toThrow('Job cancelled')

    expect(listRawFiles()).toEqual([])
  })
})
