import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { DownloadManagerService } from '../DownloadManagerService'
import type { DownloadConflictPolicy } from '../downloadPath'
import { DownloadStore } from '../downloadStore'
import type { FetchLike } from '../probe'
import { planSegments } from '../segmentedDownload'

const CONTENT = Buffer.alloc(64 * 1024, 7)

/** The recovery paths under test are private; the service is the only entry point. */
function internals(service: DownloadManagerService) {
  return service as unknown as {
    reservePath(dir: string, fileName: string, policy: DownloadConflictPolicy): Promise<string>
    fetchFor(partition: string): FetchLike
    enqueue(taskId: string): void
    pump(): void
    queue: string[]
    running: Map<string, AbortController>
  }
}

describe('DownloadManagerService recovery', () => {
  const dbh = setupTestDatabase()
  let store: DownloadStore
  let dir: string

  beforeEach(async () => {
    BaseService.resetInstances()
    store = new DownloadStore(dbh.db)
    dir = mkdtempSync(join(tmpdir(), 'cs-download-recovery-'))
    await application.get('PreferenceService').set('app.browser.downloads.auto_resume', false)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function createTask(fileName = 'payload.bin', totalBytes = CONTENT.length) {
    const filePath = join(dir, fileName)
    const tempPath = `${filePath}.crdownload`
    const { task } = store.create({
      url: 'http://127.0.0.1/file',
      finalUrl: 'http://127.0.0.1/file',
      fileName,
      filePath,
      tempPath,
      totalBytes,
      connections: 2,
      source: 'manual',
      etag: '"v1"',
      ranges: planSegments(totalBytes, 2, 1)
    })
    return { task, filePath, tempPath }
  }

  it('completes a finalized merge instead of resuming over the destination', async () => {
    const { task, filePath } = createTask()
    writeFileSync(filePath, CONTENT)
    store.setState(task.id, 'merging')

    await new DownloadManagerService()._doInit()

    const stored = store.get(task.id)!
    expect(stored.task.state).toBe('completed')
    expect(stored.task.tempPath).toBe('')
    expect(readFileSync(filePath).equals(CONTENT)).toBe(true)
  })

  it('discards recorded offsets when the finalized merge has no payload', async () => {
    const { task, filePath } = createTask()
    writeFileSync(filePath, Buffer.alloc(16))
    store.saveProgress(
      task.id,
      CONTENT.length,
      planSegments(CONTENT.length, 2, 1).map((range) => ({ index: range.index, received: range.end - range.start }))
    )
    store.setState(task.id, 'merging')

    await new DownloadManagerService()._doInit()

    const stored = store.get(task.id)!
    expect(stored.task.state).toBe('paused')
    expect(stored.task.receivedBytes).toBe(0)
    expect(stored.segments.every((segment) => segment.received === 0)).toBe(true)
    // The damaged destination is left alone until the task runs again.
    expect(readFileSync(filePath).length).toBe(16)
  })

  it('keeps the destination of an unfinished task reserved across a restart', async () => {
    const { task, filePath, tempPath } = createTask()
    writeFileSync(tempPath, 'partial')
    store.setState(task.id, 'downloading')

    const service = new DownloadManagerService()
    await service._doInit()

    expect(store.get(task.id)?.task.state).toBe('paused')
    const picked = await internals(service).reservePath(dir, 'payload.bin', 'uniquify')
    expect(picked).toBe(join(dir, 'payload (1).bin'))
    expect(picked).not.toBe(filePath)
  })

  it('treats an orphaned temporary file as a taken name', async () => {
    writeFileSync(join(dir, 'orphan.bin.crdownload'), 'stale')

    const service = new DownloadManagerService()
    await service._doInit()

    const picked = await internals(service).reservePath(dir, 'orphan.bin', 'uniquify')
    expect(picked).toBe(join(dir, 'orphan (1).bin'))
  })

  it('gives concurrent reservations distinct destinations', async () => {
    const service = new DownloadManagerService()
    await service._doInit()

    const picked = await Promise.all(
      Array.from({ length: 20 }, () => internals(service).reservePath(dir, 'same.bin', 'uniquify'))
    )

    expect(new Set(picked).size).toBe(picked.length)
  })

  it('drops a paused queued task from the pending queue', async () => {
    const { task } = createTask()
    store.setState(task.id, 'queued')

    const service = new DownloadManagerService()
    await service._doInit()
    const view = internals(service)
    view.enqueue(task.id)
    expect(view.queue).toContain(task.id)

    service.pause(task.id)

    expect(view.queue).not.toContain(task.id)
    expect(store.get(task.id)?.task.state).toBe('paused')
    view.pump()
    await Promise.resolve()
    expect(store.get(task.id)?.task.state).toBe('paused')
  })

  it('keeps a cancelled task cancelled when the runner settles', async () => {
    const { task } = createTask()
    store.setState(task.id, 'queued')

    const service = new DownloadManagerService()
    await service._doInit()
    const hang: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true
        })
      })
    const view = internals(service)
    vi.spyOn(view, 'fetchFor').mockReturnValue(hang)

    service.resume(task.id)
    await vi.waitFor(() => expect(store.get(task.id)?.task.state).toBe('downloading'))

    service.cancel(task.id)
    await vi.waitFor(() => expect(view.running.has(task.id)).toBe(false))

    expect(store.get(task.id)?.task.state).toBe('cancelled')
  })
})
