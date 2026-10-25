import { existsSync, mkdtempSync, promises as fs, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

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
    reservePath(dir: string, fileName: string, policy: DownloadConflictPolicy, owner?: string): Promise<string>
    fetchFor(partition: string): FetchLike
    enqueue(taskId: string): void
    pump(): void
    store: DownloadStore
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

  it('keeps overwrite destinations exclusive between live tasks', async () => {
    const service = new DownloadManagerService()
    await service._doInit()

    const first = await internals(service).reservePath(dir, 'same.bin', 'overwrite')
    const second = await internals(service).reservePath(dir, 'same.bin', 'overwrite')

    expect(first).toBe(join(dir, 'same.bin'))
    expect(second).toBe(join(dir, 'same (1).bin'))
  })

  it('does not let a download alias another task temporary path', async () => {
    const service = new DownloadManagerService()
    await service._doInit()

    const first = await internals(service).reservePath(dir, 'report.bin', 'uniquify')
    const second = await internals(service).reservePath(dir, 'report.bin.crdownload', 'uniquify')

    expect(first).toBe(join(dir, 'report.bin'))
    expect(second).not.toBe(`${first}.crdownload`)
    expect(second).toBe(join(dir, 'report.bin (1).crdownload'))
  })

  it('treats case and Unicode equivalent destinations as one reservation', async () => {
    const service = new DownloadManagerService()
    await service._doInit()

    expect(await internals(service).reservePath(dir, 'report.bin', 'uniquify')).toBe(join(dir, 'report.bin'))
    expect(await internals(service).reservePath(dir, 'REPORT.bin', 'uniquify')).toBe(join(dir, 'REPORT (1).bin'))
    expect(await internals(service).reservePath(dir, 'café.bin', 'uniquify')).toBe(join(dir, 'café.bin'))
    expect(await internals(service).reservePath(dir, 'cafe\u0301.bin', 'uniquify')).toBe(
      join(dir, 'cafe\u0301 (1).bin')
    )
  })

  it('keeps the unique suffix on a name already at the length limit', async () => {
    const service = new DownloadManagerService()
    await service._doInit()

    const first = await internals(service).reservePath(dir, 'a'.repeat(120), 'uniquify')
    const second = await internals(service).reservePath(dir, 'a'.repeat(120), 'uniquify')

    expect(first).toBe(join(dir, 'a'.repeat(120)))
    const secondName = basename(second)
    expect(secondName.length).toBeLessThanOrEqual(120)
    expect(secondName.endsWith(' (1)')).toBe(true)
  })

  it('keeps a failed task destination reserved across restart', async () => {
    const { task } = createTask('payload.bin')
    store.setState(task.id, 'failed', 'probe failed')

    BaseService.resetInstances()
    const restarted = new DownloadManagerService()
    await restarted._doInit()

    const next = await internals(restarted).reservePath(dir, 'payload.bin', 'uniquify')
    expect(next).toBe(join(dir, 'payload (1).bin'))
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

  it('does not let a removed cancelled row release or delete a newer task files', async () => {
    const service = new DownloadManagerService()
    await service._doInit()
    const view = internals(service)

    const cancelled = createTask('payload.bin')
    expect(await view.reservePath(dir, 'payload.bin', 'uniquify', cancelled.task.id)).toBe(cancelled.filePath)
    service.cancel(cancelled.task.id)

    // The cancelled row releases its paths; a newer download may reuse the name.
    const reused = await view.reservePath(dir, 'payload.bin', 'uniquify', 'new-task')
    expect(reused).toBe(cancelled.filePath)
    writeFileSync(`${reused}.crdownload`, 'payload')

    await service.remove(cancelled.task.id)

    expect(existsSync(`${reused}.crdownload`)).toBe(true)
    expect(await view.reservePath(dir, 'payload.bin', 'uniquify', 'third-task')).toBe(join(dir, 'payload (1).bin'))
  })

  it('defers removal until a live worker has finished its rename', async () => {
    const { task } = createTask('remove-merge.bin')

    const service = new DownloadManagerService()
    await service._doInit()
    const view = internals(service)
    vi.spyOn(view, 'fetchFor').mockReturnValue(servingFetch())

    const realRename = fs.rename
    let releaseRename!: () => void
    const renameGate = new Promise<void>((resolve) => (releaseRename = resolve))
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await renameGate
      return realRename(from, to)
    })

    try {
      service.resume(task.id)
      await vi.waitFor(() => expect(store.get(task.id)?.task.state).toBe('merging'))

      await service.remove(task.id)
      // The rename is still pending: the row and its paths must stay owned.
      expect(store.get(task.id)).toBeDefined()

      releaseRename()
      await vi.waitFor(() => expect(store.get(task.id)).toBeUndefined())
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('dispatches a resume that arrives while the worker is closing its file', async () => {
    const { task } = createTask('resume-close.bin')

    const service = new DownloadManagerService()
    await service._doInit()
    const view = internals(service)

    const serve = servingFetch()
    let stalled = false
    const stallingOnce: FetchLike = (url, init) => {
      const header = new Headers(init?.headers).get('range')
      const range = header ? /bytes=(\d+)-(\d+)/.exec(header) : null
      if (stalled || !range) return serve(url, init)
      stalled = true
      const start = Number(range[1])
      const end = Math.min(Number(range[2]), CONTENT.length - 1)
      const slice = CONTENT.subarray(start, end + 1)
      const signal = init?.signal
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(slice.subarray(0, 4096))
          await new Promise<void>((_resolve, reject) => {
            const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
            if (signal?.aborted) return onAbort()
            signal?.addEventListener('abort', onAbort, { once: true })
          })
          controller.close()
        }
      })
      return Promise.resolve(
        new Response(body, {
          status: 206,
          headers: { 'content-range': `bytes ${start}-${end}/${CONTENT.length}` }
        })
      )
    }
    vi.spyOn(view, 'fetchFor').mockReturnValue(stallingOnce)

    const realSetState = view.store.setState.bind(view.store)
    const setStateSpy = vi.spyOn(view.store, 'setState').mockImplementation((taskId, state, error) => {
      realSetState(taskId, state, error)
      // Resume arrives after `paused` is persisted but before the worker leaves
      // `running`, so `enqueue` cannot accept it at that moment.
      if (taskId === task.id && state === 'paused') service.resume(task.id)
    })

    try {
      service.resume(task.id)
      await vi.waitFor(() => expect(store.get(task.id)?.task.state).toBe('downloading'))

      service.pause(task.id)
      await vi.waitFor(() => expect(store.get(task.id)?.task.state).toBe('completed'), { timeout: 5000 })
    } finally {
      setStateSpy.mockRestore()
    }
  })

  /** Serves HEAD and byte ranges from CONTENT; `gate` holds every HEAD response. */
  function servingFetch(gate: Promise<void> = Promise.resolve()): FetchLike {
    return async (_url, init) => {
      if (init?.method === 'HEAD') {
        await gate
        return new Response(null, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(CONTENT.length),
            'accept-ranges': 'bytes'
          }
        })
      }
      const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('range') ?? '')
      const start = Number(range?.[1] ?? 0)
      const end = Math.min(Number(range?.[2] ?? CONTENT.length - 1), CONTENT.length - 1)
      return new Response(CONTENT.subarray(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${CONTENT.length}`,
          'content-length': String(end - start + 1)
        }
      })
    }
  }

  it('serializes overlapping retries so the late probe cannot requeue the task', async () => {
    const { task } = createTask()
    store.setState(task.id, 'failed', 'probe failed')

    const service = new DownloadManagerService()
    await service._doInit()
    const view = internals(service)

    let releaseHead!: () => void
    const headGate = new Promise<void>((resolve) => (releaseHead = resolve))
    let heads = 0
    const serve = servingFetch(headGate)
    vi.spyOn(view, 'fetchFor').mockReturnValue(async (url, init) => {
      if (init?.method === 'HEAD') heads += 1
      return serve(url, init)
    })

    const first = service.retry(task.id)
    const second = service.retry(task.id)
    // The second click joins the probe in flight instead of starting its own.
    expect(heads).toBe(1)

    releaseHead()
    await Promise.all([first, second])

    await vi.waitFor(() => expect(store.get(task.id)?.task.state).toBe('completed'))
    expect(store.get(task.id)?.task.tempPath).toBe('')
  })

  it('leaves a task alone when it stops being failed during the retry probe', async () => {
    const { task, filePath } = createTask()
    store.setState(task.id, 'failed', 'probe failed')

    const service = new DownloadManagerService()
    await service._doInit()
    const view = internals(service)

    let releaseHead!: () => void
    const headGate = new Promise<void>((resolve) => (releaseHead = resolve))
    vi.spyOn(view, 'fetchFor').mockReturnValue(servingFetch(headGate))

    const retrying = service.retry(task.id)
    // Another actor finishes the row while this probe is still waiting.
    store.complete(task.id, filePath, CONTENT.length)
    releaseHead()
    await retrying

    const stored = store.get(task.id)!
    expect(stored.task.state).toBe('completed')
    expect(stored.task.tempPath).toBe('')
    expect(view.queue).not.toContain(task.id)
  })
})
