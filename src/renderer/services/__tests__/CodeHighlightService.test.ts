import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { HighlightRequest, HighlightResponse, HighlightValue } from '@renderer/types/codeHighlight'

import { codeHighlightService } from '../CodeHighlightService'

type Request = HighlightRequest & { id: number; generation: number }
const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker {
    static instances: FakeWorker[] = []
    onmessage?: (event: { data: HighlightResponse }) => void
    onerror?: () => void
    onmessageerror?: () => void
    requests: Request[] = []
    terminated = false
    constructor() {
      FakeWorker.instances.push(this)
    }
    postMessage(request: Request) {
      this.requests.push(request)
      if (['open', 'update', 'configure', 'close'].includes(request.type))
        queueMicrotask(() => this.respond(request, null))
    }
    respond(request: Request, result: HighlightValue) {
      this.onmessage?.({ data: { ...request, result } })
    }
    terminate() {
      this.terminated = true
    }
  }
  return { FakeWorker }
})
vi.stubGlobal('Worker', FakeWorker)
afterAll(() => vi.unstubAllGlobals())
afterEach(() => {
  codeHighlightService.dispose()
  FakeWorker.instances = []
  vi.useRealTimers()
})
const latest = () => FakeWorker.instances.at(-1)!
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const lines = (content: string) => ({ start: 0, lines: [[{ content, offset: 0 }]] })
const read = (code: string, id = 'a') =>
  codeHighlightService.highlightRange(code, 'ts', 'one-light', id, { start: 0, end: 1 })

describe('CodeHighlightService', () => {
  it('sends source only on open or update, and appends only the UTF-16 delta', async () => {
    const first = read('const a = "🍒"')
    await flush()
    latest().respond(latest().requests.at(-1)!, lines('const a = "🍒"'))
    await first
    latest().requests = []
    const scroll = read('const a = "🍒"')
    await flush()
    expect(latest().requests).toHaveLength(1)
    expect(latest().requests[0]).toMatchObject({ type: 'read', range: { start: 0, end: 1 } })
    expect(latest().requests[0]).not.toHaveProperty('code')
    latest().respond(latest().requests[0], lines('const a = "🍒"'))
    await scroll
    latest().requests = []
    const append = read('const a = "🍒"\n// next')
    await flush()
    expect(latest().requests[0]).toMatchObject({
      type: 'update',
      baseRevision: 0,
      revision: 1,
      change: {
        type: 'edits',
        edits: [{ range: { start: { line: 0, character: 14 }, end: { line: 0, character: 14 } }, newText: '\n// next' }]
      }
    })
    latest().respond(latest().requests.at(-1)!, lines('const a = "🍒"'))
    await append
  })

  it('reuses syntax across palettes without reopening or reconfiguring the document', async () => {
    const source = 'const answer = 42'
    const tokens = { start: 0, lines: [[{ content: source, offset: 0, className: 'code-syntax-keyword' }]] }
    const first = read(source)
    await flush()
    latest().respond(latest().requests.at(-1)!, tokens)
    expect(await first).toEqual(tokens)
    latest().requests = []
    const dark = codeHighlightService.highlightRange(source, 'ts', 'material-theme-darker', 'a', { start: 0, end: 1 })
    await flush()
    expect(latest().requests.map((request) => request.type)).toEqual(['read'])
    latest().respond(latest().requests[0], tokens)
    expect(await dark).toEqual(tokens)
  })

  it('routes concurrent callers even when responses arrive out of order', async () => {
    const first = read('alpha', 'first')
    const second = read('beta', 'second')
    await flush()
    const requests = latest().requests.filter((request) => request.type === 'read')
    latest().respond(requests[1], lines('beta'))
    latest().respond(requests[0], lines('alpha'))
    expect((await first).lines[0][0].content).toBe('alpha')
    expect((await second).lines[0][0].content).toBe('beta')
  })

  it('does not apply a reply from another source revision', async () => {
    const task = read('current source', 'revision')
    await flush()
    const request = latest().requests.at(-1)!
    latest().onmessage!({ data: { ...request, revision: 99, result: lines('stale source') } })
    expect((await task).lines).toEqual(lines('current source').lines)
  })

  it('reopens an evicted session once, and settles a repeated miss as plain text', async () => {
    const task = read('recover')
    await flush()
    const missing = () => {
      const request = latest().requests.at(-1)!
      latest().onmessage!({ data: { id: request.id, generation: request.generation, error: 'expired', missing: true } })
    }
    missing()
    await flush()
    missing()
    expect((await task).lines).toEqual(lines('recover').lines)
    expect(latest().requests.filter((request) => request.type === 'open')).toHaveLength(2)
  })

  it('ignores a closed session result and isolates a replacement with the same caller ID', async () => {
    const first = read('old', 'reuse')
    await flush()
    const old = latest().requests.at(-1)!
    codeHighlightService.cleanupTokenizers('reuse')
    const next = read('new', 'reuse')
    await flush()
    const current = latest().requests.at(-1)!
    expect('sessionId' in old && 'sessionId' in current && old.sessionId).not.toBe(
      'sessionId' in current && current.sessionId
    )
    latest().respond(current, lines('new'))
    latest().respond(old, lines('obsolete'))
    expect((await first).lines).toEqual(lines('old').lines)
    expect((await next).lines).toEqual(lines('new').lines)
  })

  it('settles all crash requests and recovers without a stale worker killing its replacement', async () => {
    const pending = read('first\n 🍒')
    await flush()
    const crashed = latest()
    crashed.onerror!()
    expect((await pending).lines[0][0].content).toBe('first')
    const recovered = read('recovered')
    await flush()
    const replacement = latest()
    crashed.onerror!()
    expect(replacement.terminated).toBe(false)
    expect(replacement.requests[0].type).toBe('open')
    replacement.respond(replacement.requests.at(-1)!, lines('recovered'))
    expect((await recovered).lines).toEqual(lines('recovered').lines)
  })

  it.each(['html', 'markdown'] as const)('escapes %s fallback on failure', async (type) => {
    const source = '<img src=x onerror=alert(1)> &'
    const task =
      type === 'html'
        ? codeHighlightService.highlightCodeToHtml(source, 'html', 'one-light')
        : codeHighlightService.renderMarkdown(source, 'one-light')
    latest().onerror!()
    const container = document.createElement('div')
    container.innerHTML = await task
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe(source)
  })

  it('settles pending work on timeout instead of leaving the viewer dimmed', async () => {
    vi.useFakeTimers()
    const task = read('unfinished')
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await task).lines).toEqual(lines('unfinished').lines)
    expect(latest().terminated).toBe(true)
  })
})
