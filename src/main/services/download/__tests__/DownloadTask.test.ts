import { existsSync, mkdtempSync, promises as fs, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { DownloadStore } from '../downloadStore'
import { DownloadTask, ValidatorChangedError } from '../DownloadTask'
import type { FetchLike } from '../probe'
import { planSegments } from '../segmentedDownload'

const CONTENT = Buffer.alloc(1024 * 1024, 3)

let server: Server
let baseUrl: string
let dir: string

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(CONTENT.length),
        'accept-ranges': 'bytes',
        etag: '"v1"'
      })
      response.end()
      return
    }
    const range = /bytes=(\d+)-(\d+)/.exec(String(request.headers.range))
    const start = range ? Number(range[1]) : 0
    const end = range ? Math.min(Number(range[2]), CONTENT.length - 1) : CONTENT.length - 1
    response.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${CONTENT.length}`,
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      etag: '"v1"'
    })
    response.end(CONTENT.subarray(start, end + 1))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** Emits `stallAfterBytes` then waits for the request to be aborted. */
function stallingFetch(stallAfterBytes: number): FetchLike {
  return async (_url, init) => {
    const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('range') ?? '')
    const start = Number(range?.[1] ?? 0)
    const end = Number(range?.[2] ?? CONTENT.length - 1)
    const slice = CONTENT.subarray(start, end + 1)
    const signal = init?.signal ?? undefined
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(slice.subarray(0, Math.min(stallAfterBytes, slice.length)))
          await new Promise<void>((_, reject) => {
            const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
            if (signal?.aborted) return onAbort()
            signal?.addEventListener('abort', onAbort, { once: true })
          })
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      }
    })
    return new Response(body, {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${CONTENT.length}` }
    })
  }
}

/** Answers every range request with 200, as a server would after the file changed. */
const changedFileFetch: FetchLike = async () =>
  new Response(CONTENT, { status: 200, headers: { 'content-length': String(CONTENT.length) } })

describe('DownloadTask', () => {
  const dbh = setupTestDatabase()
  let store: DownloadStore

  beforeEach(async () => {
    store = new DownloadStore(dbh.db)
    dir = mkdtempSync(join(tmpdir(), 'cs-download-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function createTask(connections: number) {
    const fileName = 'payload.bin'
    const filePath = join(dir, fileName)
    const tempPath = join(dir, `${fileName}.crdownload`)
    const ranges = planSegments(CONTENT.length, connections, 1)
    const created = store.create({
      url: `${baseUrl}/file`,
      finalUrl: `${baseUrl}/file`,
      fileName,
      filePath,
      tempPath,
      totalBytes: CONTENT.length,
      connections,
      source: 'manual',
      etag: '"v1"',
      ranges
    })
    return { ...created, filePath, tempPath }
  }

  it('downloads every segment into one file and marks the task completed', async () => {
    const { task, segments, filePath } = createTask(4)

    const runner = new DownloadTask({
      task,
      segments,
      probe: { finalUrl: task.url, totalBytes: CONTENT.length, supportsRanges: true, etag: '"v1"' },
      store,
      fetchImpl: fetch,
      retryDelayMs: 0,
      progressFlushBytes: 1
    })

    await expect(runner.run(new AbortController().signal)).resolves.toBe('completed')

    const downloaded = await fs.readFile(filePath)
    expect(downloaded.equals(CONTENT)).toBe(true)
    const stored = store.get(task.id)
    expect(stored?.task.state).toBe('completed')
    expect(stored?.segments.reduce((sum, segment) => sum + segment.received, 0)).toBe(CONTENT.length)
    expect(stored?.task.receivedBytes).toBe(CONTENT.length)
  })

  it('pauses with progress recorded and resumes from the recorded offsets', async () => {
    const { task, segments, filePath } = createTask(2)
    const probe = { finalUrl: task.url, totalBytes: CONTENT.length, supportsRanges: true, etag: '"v1"' }
    const controller = new AbortController()

    const first = new DownloadTask({
      task,
      segments,
      probe,
      store,
      fetchImpl: stallingFetch(4096),
      retryDelayMs: 0,
      progressFlushBytes: 1,
      onProgress: (received) => {
        if (received > 0) controller.abort()
      }
    })
    await expect(first.run(controller.signal)).resolves.toBe('paused')

    const paused = store.get(task.id)!
    expect(paused.task.state).toBe('paused')
    expect(paused.task.receivedBytes).toBeGreaterThan(0)
    expect(paused.task.receivedBytes).toBeLessThan(CONTENT.length)

    const second = new DownloadTask({
      task: paused.task,
      segments: paused.segments,
      probe,
      store,
      fetchImpl: fetch,
      retryDelayMs: 0,
      progressFlushBytes: 1
    })
    await expect(second.run(new AbortController().signal)).resolves.toBe('completed')

    expect((await fs.readFile(filePath)).equals(CONTENT)).toBe(true)
    expect(store.get(task.id)?.task.state).toBe('completed')
  })

  it('re-downloads instead of trusting offsets when the temporary file is gone', async () => {
    const { task, segments, filePath, tempPath } = createTask(2)
    // Crash window: every byte was recorded, then the rename ran and the temp
    // file disappeared before complete() persisted the final state.
    store.saveProgress(
      task.id,
      CONTENT.length,
      segments.map((segment) => ({ index: segment.idx, received: segment.end - segment.start }))
    )
    store.setState(task.id, 'paused')
    expect(existsSync(tempPath)).toBe(false)

    const ranges: string[] = []
    const countingFetch: FetchLike = async (url, init) => {
      ranges.push(new Headers(init?.headers).get('range') ?? '')
      return fetch(url, init)
    }
    const paused = store.get(task.id)!

    const runner = new DownloadTask({
      task: paused.task,
      segments: paused.segments,
      probe: { finalUrl: task.url, totalBytes: CONTENT.length, supportsRanges: true, etag: '"v1"' },
      store,
      fetchImpl: countingFetch,
      retryDelayMs: 0,
      progressFlushBytes: 1
    })

    await expect(runner.run(new AbortController().signal)).resolves.toBe('completed')

    expect(ranges.length).toBeGreaterThan(0)
    expect((await fs.readFile(filePath)).equals(CONTENT)).toBe(true)
    expect(store.get(task.id)?.task.state).toBe('completed')
  })

  it('fails the task when the remote file changed under a running range request', async () => {
    const { task, segments } = createTask(2)

    const runner = new DownloadTask({
      task,
      segments,
      probe: { finalUrl: task.url, totalBytes: CONTENT.length, supportsRanges: true, etag: '"v1"' },
      store,
      fetchImpl: changedFileFetch,
      retryDelayMs: 0,
      maxSegmentAttempts: 1
    })

    await expect(runner.run(new AbortController().signal)).rejects.toBeInstanceOf(ValidatorChangedError)
    expect(store.get(task.id)?.task.state).toBe('failed')
  })
})
