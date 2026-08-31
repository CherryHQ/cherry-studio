import type { NotesTreeNode } from '@shared/types/note'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { preferenceGetMock, readMock, realpathMock, statMock } = vi.hoisted(() => ({
  preferenceGetMock: vi.fn(),
  readMock: vi.fn(),
  realpathMock: vi.fn(),
  statMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ PreferenceService: { get: preferenceGetMock } })
})

vi.mock('@main/utils/file', () => ({
  isSameOrInside: (candidate: string, container: string) =>
    candidate === container || candidate.startsWith(`${container}/`),
  readTextFileWithinRoots: (filePath: string, _roots: string[], options: unknown) => readMock(filePath, options),
  realpath: realpathMock,
  stat: statMock
}))

import { BaseService } from '@main/core/lifecycle'

import { NotesSearchService } from '../NotesSearchService'

const { application } = await import('@application')
const applicationGetPathMock = vi.mocked(application.getPath)

const NOW = Date.parse('2026-08-25T00:00:00.000Z')

function note(id: string, overrides: Partial<NotesTreeNode> = {}): NotesTreeNode {
  return {
    id,
    name: id,
    type: 'file',
    treePath: `${id}.md`,
    externalPath: `/notes/${id}.md`,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: new Date(NOW).toISOString(),
    ...overrides
  }
}

function requestContext(requestId: string, senderId = 'window-1') {
  return { requestId, senderId }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('NotesSearchService', () => {
  let service: NotesSearchService

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    BaseService.resetInstances()
    applicationGetPathMock.mockReturnValue('/notes')
    preferenceGetMock.mockReturnValue('/notes')
    realpathMock.mockImplementation(async (filePath: string) => filePath)
    statMock.mockResolvedValue({ size: 20, createdAt: NOW, modifiedAt: NOW, isDirectory: false, isFile: true })
    readMock.mockResolvedValue('')
    service = new NotesSearchService()
    await service._doInit()
  })

  afterEach(async () => {
    await service._doStop()
    vi.restoreAllMocks()
  })

  it('preserves filename, content, context, and score ordering while searching in main', async () => {
    const nodes = [
      note('alpha', { name: 'alpha' }),
      note('filename', { name: 'my alpha note' }),
      note('content', { name: 'journal' }),
      note('miss', { name: 'unrelated' })
    ]
    readMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('/alpha.md')) return 'xx alpha tail'
      if (filePath.endsWith('/content.md')) return 'alpha then alpha'
      return 'nothing to see'
    })

    const results = await service.search(
      { nodes, keyword: 'alpha', options: { contextLength: 50 }, maxResults: 10 },
      requestContext('search-1')
    )

    expect(results.map(({ id, matchType }) => [id, matchType])).toEqual([
      ['alpha', 'both'],
      ['filename', 'filename'],
      ['content', 'content']
    ])
    expect(results[0].score).toBe(312)
    expect(results[0].matches).toEqual([
      {
        lineNumber: 1,
        lineContent: 'xx alpha tail',
        matchStart: 5,
        matchEnd: 10,
        context: '...x alpha tail'
      }
    ])
    expect(results[1].score).toBe(100)
    expect(results[2].score).toBe(14)
  })

  it('bounds returned line content for a very long matching line', async () => {
    readMock.mockResolvedValue(`${'x'.repeat(3_000)}needle tail`)

    const results = await service.search(
      { nodes: [note('long-line')], keyword: 'needle', options: {}, maxResults: 10 },
      requestContext('search-long-line')
    )

    expect(results[0].matches).toEqual([
      expect.objectContaining({
        lineContent: '...xxneedle tail',
        context: '...xxneedle tail'
      })
    ])
    expect(results[0].matches?.[0].lineContent.length).toBeLessThanOrEqual(2_005)
  })

  it('uses stat size to skip oversized files before reading while retaining a filename-only match', async () => {
    statMock.mockResolvedValue({ size: 11, createdAt: NOW, modifiedAt: NOW, isDirectory: false, isFile: true })

    const results = await service.search(
      {
        nodes: [note('large', { name: 'alpha archive' })],
        keyword: 'alpha',
        options: { maxFileSize: 10 },
        maxResults: 10
      },
      requestContext('search-large')
    )

    expect(statMock).toHaveBeenCalledOnce()
    expect(readMock).not.toHaveBeenCalled()
    expect(results).toEqual([expect.objectContaining({ id: 'large', matchType: 'filename', matches: [], score: 100 })])
  })

  it('skips non-regular paths before reading while retaining a filename-only match', async () => {
    statMock.mockResolvedValue({ size: 0, createdAt: NOW, modifiedAt: NOW, isDirectory: false, isFile: false })

    const results = await service.search(
      {
        nodes: [note('device', { name: 'needle device' })],
        keyword: 'needle',
        options: {},
        maxResults: 10
      },
      requestContext('search-device')
    )

    expect(readMock).not.toHaveBeenCalled()
    expect(results).toEqual([expect.objectContaining({ id: 'device', matchType: 'filename', matches: [], score: 100 })])
  })

  it('rechecks content size after reading when a file grows after stat', async () => {
    statMock.mockResolvedValue({ size: 5, createdAt: NOW, modifiedAt: NOW, isDirectory: false, isFile: true })
    readMock.mockResolvedValue('content grew')

    const results = await service.search(
      {
        nodes: [note('growing', { name: 'needle archive' })],
        keyword: 'needle',
        options: { maxFileSize: 5 },
        maxResults: 10
      },
      requestContext('search-growing')
    )

    expect(readMock).toHaveBeenCalledOnce()
    expect(results).toEqual([
      expect.objectContaining({ id: 'growing', matchType: 'filename', matches: [], score: 100 })
    ])
    expect(readMock).toHaveBeenCalledWith('/notes/growing.md', {
      maxBytes: 5,
      signal: expect.any(AbortSignal)
    })
  })

  it('does not read renderer-provided paths outside the configured notes roots', async () => {
    const results = await service.search(
      {
        nodes: [note('outside', { externalPath: '/private/outside.md', name: 'needle outside' })],
        keyword: 'needle',
        options: {},
        maxResults: 10
      },
      requestContext('search-outside')
    )

    expect(statMock).not.toHaveBeenCalled()
    expect(readMock).not.toHaveBeenCalled()
    expect(results).toEqual([
      expect.objectContaining({ id: 'outside', matchType: 'filename', matches: [], score: 100 })
    ])
  })

  it('rejects a note path whose real target escapes the configured root through a symlink', async () => {
    realpathMock.mockImplementation(async (filePath: string) =>
      filePath === '/notes/link.md' ? '/private/target.md' : filePath
    )

    await service.search(
      { nodes: [note('link')], keyword: 'needle', options: {}, maxResults: 10 },
      requestContext('search-symlink')
    )

    expect(statMock).not.toHaveBeenCalled()
    expect(readMock).not.toHaveBeenCalled()
  })

  it('bounds reads to five and aborts outstanding work after maxResults is satisfied', async () => {
    let activeReads = 0
    let peakReads = 0

    readMock.mockImplementation(
      (_filePath: string, options: { signal?: AbortSignal } = {}) =>
        new Promise<string>((resolve, reject) => {
          activeReads += 1
          peakReads = Math.max(peakReads, activeReads)
          let settled = false

          const finish = (callback: () => void) => {
            if (settled) return
            settled = true
            activeReads -= 1
            options.signal?.removeEventListener('abort', onAbort)
            callback()
          }
          const onAbort = () => finish(() => reject(options.signal?.reason))

          options.signal?.addEventListener('abort', onAbort, { once: true })
          setTimeout(() => finish(() => resolve('needle')), 5)
        })
    )

    const nodes = Array.from({ length: 30 }, (_, index) =>
      note(`note-${index}`, index < 3 ? { name: 'needle' } : undefined)
    )
    const results = await service.search(
      { nodes, keyword: 'needle', options: {}, maxResults: 3 },
      requestContext('search-limited')
    )

    expect(results).toHaveLength(3)
    expect(peakReads).toBeLessThanOrEqual(5)
    expect(activeReads).toBe(0)
    expect(readMock.mock.calls.length).toBeLessThan(nodes.length)
    expect(statMock.mock.calls.length).toBeLessThan(nodes.length)
  })

  it('keeps the global top result when a later file can outrank an earlier match', async () => {
    readMock.mockResolvedValue('needle')
    const nodes = [note('early-low-score', { name: 'journal' }), note('later-high-score', { name: 'needle' })]

    const results = await service.search(
      { nodes, keyword: 'needle', options: { maxMatchesPerFile: 1 }, maxResults: 1 },
      requestContext('search-global-top')
    )

    expect(results).toEqual([expect.objectContaining({ id: 'later-high-score', matchType: 'both', score: 312 })])
  })

  it('does not prune an unstarted candidate that can still enter the global top results', async () => {
    readMock.mockImplementation(async (filePath: string) =>
      filePath.endsWith('/late-high-score.md') ? 'needle '.repeat(25) : 'needle'
    )
    const nodes = [
      ...Array.from({ length: 5 }, (_, index) => note(`early-low-score-${index}`)),
      note('late-high-score')
    ]

    const results = await service.search(
      { nodes, keyword: 'needle', options: {}, maxResults: 1 },
      requestContext('search-queued-bound')
    )

    expect(results).toEqual([expect.objectContaining({ id: 'late-high-score', matchType: 'content', score: 60 })])
    expect(readMock).toHaveBeenCalledTimes(6)
  })

  it('waits for an in-flight candidate that can still enter the global top results', async () => {
    const delayed = createDeferred<string>()
    readMock.mockImplementation((filePath: string, options: { signal?: AbortSignal } = {}) => {
      if (!filePath.endsWith('/delayed-high-score.md')) {
        return Promise.resolve('needle')
      }

      options.signal?.addEventListener('abort', () => delayed.reject(options.signal?.reason), { once: true })
      return delayed.promise
    })
    const search = service.search(
      {
        nodes: [note('delayed-high-score'), ...Array.from({ length: 4 }, (_, index) => note(`low-score-${index}`))],
        keyword: 'needle',
        options: {},
        maxResults: 1
      },
      requestContext('search-in-flight-bound')
    )

    await vi.waitFor(() => expect(readMock).toHaveBeenCalledTimes(5))
    delayed.resolve('needle '.repeat(25))

    await expect(search).resolves.toEqual([
      expect.objectContaining({ id: 'delayed-high-score', matchType: 'content', score: 60 })
    ])
  })

  it('uses tree order as a deterministic tie-breaker regardless of read completion order', async () => {
    const pending = new Map<string, ReturnType<typeof createDeferred<string>>>()
    readMock.mockImplementation((filePath: string) => {
      const deferred = createDeferred<string>()
      pending.set(filePath, deferred)
      return deferred.promise
    })
    const search = service.search(
      { nodes: [note('first'), note('second')], keyword: 'needle', options: {}, maxResults: 10 },
      requestContext('search-tie-order')
    )

    await vi.waitFor(() => expect(pending.size).toBe(2))
    pending.get('/notes/second.md')?.resolve('needle')
    pending.get('/notes/first.md')?.resolve('needle')

    await expect(search).resolves.toEqual([
      expect.objectContaining({ id: 'first', score: 12 }),
      expect.objectContaining({ id: 'second', score: 12 })
    ])
  })

  it('treats regex metacharacters as literal search text', async () => {
    readMock.mockResolvedValue('content')

    const results = await service.search(
      {
        nodes: [note('filename-match', { name: '[ archive' }), note('content-only', { name: 'journal' })],
        keyword: '[',
        options: {},
        maxResults: 10
      },
      requestContext('search-invalid-regex')
    )

    expect(results).toEqual([
      expect.objectContaining({ id: 'filename-match', matchType: 'filename', matches: [], score: 100 })
    ])
  })

  it('returns a finite score when a note has an invalid update timestamp', async () => {
    readMock.mockResolvedValue('needle')

    const results = await service.search(
      {
        nodes: [note('invalid-date', { updatedAt: 'not-a-date' })],
        keyword: 'needle',
        options: {},
        maxResults: 10
      },
      requestContext('search-invalid-date')
    )

    expect(results).toEqual([expect.objectContaining({ id: 'invalid-date', score: 2 })])
    expect(Number.isFinite(results[0].score)).toBe(true)
  })

  it('preserves traversal of file descendants on every non-file tree node', async () => {
    readMock.mockResolvedValue('needle')
    const nestedFile = note('nested')
    const hint = note('hint-parent', { type: 'hint', children: [nestedFile] })

    await expect(
      service.search(
        { nodes: [hint], keyword: 'needle', options: {}, maxResults: 10 },
        requestContext('search-hint-descendant')
      )
    ).resolves.toEqual([expect.objectContaining({ id: 'nested', matchType: 'content' })])
  })

  it('keeps a replacement request cancellable after the superseded request settles', async () => {
    const pending: Array<{
      resolve: (content: string) => void
      signal: AbortSignal
      reject: (error: unknown) => void
    }> = []
    readMock.mockImplementation(
      (_filePath: string, options: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          pending.push({ resolve, signal: options.signal, reject })
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
    )
    const context = requestContext('reused-id')
    const firstSearch = service.search(
      { nodes: [note('first')], keyword: 'needle', options: {}, maxResults: 10 },
      context
    )

    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const secondSearch = service.search(
      { nodes: [note('second')], keyword: 'needle', options: {}, maxResults: 10 },
      context
    )

    await vi.waitFor(() => expect(pending).toHaveLength(2))
    await expect(firstSearch).resolves.toEqual([])
    expect(pending[0].signal.aborted).toBe(true)

    service.cancel(context)
    expect(pending[1].signal.aborted).toBe(true)
    await expect(secondSearch).resolves.toEqual([])
  })

  it('waits for aborted search work to settle during service teardown', async () => {
    const firstRead = createDeferred<string>()
    const secondRead = createDeferred<string>()
    readMock.mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise)
    const context = requestContext('reused-during-stop')
    const firstSearch = service.search(
      { nodes: [note('slow')], keyword: 'needle', options: {}, maxResults: 10 },
      context
    )

    await vi.waitFor(() => expect(readMock).toHaveBeenCalledOnce())
    const secondSearch = service.search(
      { nodes: [note('replacement')], keyword: 'needle', options: {}, maxResults: 10 },
      context
    )
    await vi.waitFor(() => expect(readMock).toHaveBeenCalledTimes(2))

    let stopped = false
    const stop = service._doStop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)

    secondRead.resolve('needle')
    await Promise.resolve()
    expect(stopped).toBe(false)

    firstRead.resolve('needle')
    await expect(stop).resolves.toBeUndefined()
    await expect(firstSearch).resolves.toEqual([])
    await expect(secondSearch).resolves.toEqual([])
  })

  it('supersedes the previous search from the same sender and ignores a late cancel for it', async () => {
    const pending = new Map<
      string,
      { resolve: (content: string) => void; signal: AbortSignal; reject: (error: unknown) => void }
    >()
    readMock.mockImplementation(
      (filePath: string, options: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          pending.set(filePath, { resolve, signal: options.signal, reject })
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
    )
    const firstContext = requestContext('first-request', 'same-window')
    const secondContext = requestContext('second-request', 'same-window')
    const firstSearch = service.search(
      { nodes: [note('first')], keyword: 'needle', options: {}, maxResults: 10 },
      firstContext
    )

    await vi.waitFor(() => expect(pending.size).toBe(1))
    const secondSearch = service.search(
      { nodes: [note('second')], keyword: 'needle', options: {}, maxResults: 10 },
      secondContext
    )
    await vi.waitFor(() => expect(pending.size).toBe(2))

    await expect(firstSearch).resolves.toEqual([])
    expect(pending.get('/notes/first.md')?.signal.aborted).toBe(true)
    service.cancel(firstContext)
    expect(pending.get('/notes/second.md')?.signal.aborted).toBe(false)

    pending.get('/notes/second.md')?.resolve('needle')
    await expect(secondSearch).resolves.toEqual([expect.objectContaining({ id: 'second', matchType: 'content' })])
  })

  it('scopes cancellation by senderId and requestId', async () => {
    const pending = new Map<
      string,
      { resolve: (content: string) => void; signal: AbortSignal; reject: (error: unknown) => void }
    >()
    readMock.mockImplementation(
      (filePath: string, options: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          pending.set(filePath, { resolve, signal: options.signal, reject })
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
    )

    const firstContext = requestContext('same-id', 'window-a')
    const secondContext = requestContext('same-id', 'window-b')
    const firstSearch = service.search(
      { nodes: [note('first')], keyword: 'needle', options: {}, maxResults: 10 },
      firstContext
    )
    const secondSearch = service.search(
      { nodes: [note('second')], keyword: 'needle', options: {}, maxResults: 10 },
      secondContext
    )

    await vi.waitFor(() => expect(pending.size).toBe(2))
    service.cancel(firstContext)

    await expect(firstSearch).resolves.toEqual([])
    expect(pending.get('/notes/first.md')?.signal.aborted).toBe(true)
    expect(pending.get('/notes/second.md')?.signal.aborted).toBe(false)

    pending.get('/notes/second.md')?.resolve('needle')
    await expect(secondSearch).resolves.toEqual([expect.objectContaining({ id: 'second', matchType: 'content' })])
  })
})
