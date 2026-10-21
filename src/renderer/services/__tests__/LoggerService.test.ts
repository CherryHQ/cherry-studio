import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LoggerModule from '../LoggerService'

// `@logger` is globally mocked in renderer.setup.ts, and it resolves to the same
// file as this relative import — so we must load the real module via importActual.
let LoggerService: typeof LoggerModule.LoggerService
let resolveWindowSourceFromMeta: typeof LoggerModule.resolveWindowSourceFromMeta

beforeAll(async () => {
  const actual = await vi.importActual<typeof LoggerModule>('../LoggerService')
  LoggerService = actual.LoggerService
  resolveWindowSourceFromMeta = actual.resolveWindowSourceFromMeta
})

function parseDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('resolveWindowSourceFromMeta', () => {
  it('returns the content of the logger-window-source meta', () => {
    const doc = parseDocument('<head><meta name="logger-window-source" content="mainWindow" /></head>')
    expect(resolveWindowSourceFromMeta(doc)).toBe('mainWindow')
  })

  it('returns an empty string when the meta is absent', () => {
    const doc = parseDocument('<head></head>')
    expect(resolveWindowSourceFromMeta(doc)).toBe('')
  })

  it('returns an empty string when there is no document (worker context)', () => {
    expect(resolveWindowSourceFromMeta(undefined)).toBe('')
  })

  it('trims surrounding whitespace and ignores blank content', () => {
    const doc = parseDocument('<head><meta name="logger-window-source" content="   " /></head>')
    expect(resolveWindowSourceFromMeta(doc)).toBe('')
  })
})

describe('LoggerService window source resolution', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    vi.spyOn(window.electron.ipcRenderer, 'invoke').mockResolvedValue(undefined)
    // Silence the logger's own console output so test output stays pristine.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // `processLog` sends `(channel, source, level, message, data)` to main at WARN+.
  function lastLoggedSource(): { window: string } {
    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)
    return call?.[1] as { window: string }
  }

  it('derives the window source from the meta tag at construction time', () => {
    document.head.innerHTML = '<meta name="logger-window-source" content="mainWindow" />'

    const logger = new LoggerService()
    logger.error('boom')

    expect(lastLoggedSource().window).toBe('mainWindow')
  })

  it('lets an explicit initWindowSource override the derived source', () => {
    document.head.innerHTML = '<meta name="logger-window-source" content="mainWindow" />'

    const logger = new LoggerService()
    logger.initWindowSource('Worker')
    logger.error('boom')

    expect(lastLoggedSource().window).toBe('Worker')
  })

  it('falls back to UNKNOWN and reports it when neither explicit nor meta source exists', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const logger = new LoggerService()
    logger.error('boom')

    expect(lastLoggedSource().window).toBe('UNKNOWN')
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('window source not initialized'))
  })

  it('preserves custom error classification across structured-clone IPC', () => {
    const logger = new LoggerService()
    const error = Object.assign(new Error('User cancelled'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
      retry: () => true
    })
    logger.error('Translation stopped', error)
    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!
    const [serialized] = structuredClone(call[4])
    expect(serialized).toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
      errorMessage: 'User cancelled',
      stack: error.stack
    })
  })
  const forwarded = () => vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!

  it('[22243 RED] forwards nested stream diagnostics as safe enumerable data', () => {
    const streamError = Object.assign(new Error('socket closed'), {
      code: 'ECONNRESET',
      statusCode: 503,
      status: 502,
      originalName: 'ProviderStreamError'
    })
    const metadata = { topicId: 't1', streamError }
    new LoggerService().withContext('useChatWithHistory').error('AI stream error', metadata)
    const projected = forwarded()[4][0].streamError
    expect(Object.getPrototypeOf(projected)).toBe(Object.prototype)
    expect(projected).not.toBeInstanceOf(Error)
    expect(JSON.parse(JSON.stringify(projected))).toStrictEqual({
      name: 'Error',
      message: 'socket closed',
      stack: streamError.stack,
      code: 'ECONNRESET',
      statusCode: 503,
      status: 502,
      originalName: 'ProviderStreamError'
    })
    expect(metadata.streamError).toBe(streamError)
  })

  it('[22243 RED] normalizes errors in arrays and source context before forwarding', () => {
    const error = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
    new LoggerService().withContext('test', { failure: error }).error('failed', [error])
    const call = forwarded()
    const expected = { name: 'Error', message: 'socket closed', stack: error.stack, code: 'ECONNRESET' }
    expect(JSON.parse(JSON.stringify(call[1].context))).toStrictEqual({ failure: expected })
    expect(JSON.parse(JSON.stringify(call[4]))).toStrictEqual([[expected]])
  })

  it('[22243 RED] drops private error payloads and bounds diagnostic strings', () => {
    const error = Object.assign(new Error('api_key=secret-sentinel\n' + 'm'.repeat(600)), {
      name: 'n'.repeat(120),
      stack: 'Authorization: Bearer secret-sentinel\n' + 's'.repeat(5000),
      code: 'api_key=secret-sentinel',
      originalName: 'x'.repeat(101),
      statusCode: Infinity,
      status: '503',
      retry: () => true
    })
    const forbidden = [
      'requestBodyValues',
      'responseBody',
      'data',
      'response',
      'responseHeaders',
      'prompt',
      'toolInput',
      'originalMessage',
      'cause',
      'errors',
      'lastError',
      'url'
    ]
    for (const key of forbidden) Object.defineProperty(error, key, { value: 'private-sentinel', enumerable: true })
    new LoggerService().error('failed', { streamError: error, requestId: 'r1' })
    const output = forwarded()[4][0]
    expect(output.requestId).toBe('r1')
    const json = JSON.stringify(output)
    for (const key of forbidden) expect(json).not.toContain('"' + key + '"')
    expect(json).not.toMatch(/secret-sentinel|private-sentinel|retry/)
    expect(output.streamError.name).toHaveLength(100)
    expect(output.streamError.message).toHaveLength(501)
    expect(output.streamError.message).toMatch(/…$/)
    expect(output.streamError.stack).toHaveLength(4000)
    expect(output.streamError.code).toBe('api_key="<redacted>"')
    expect(output.streamError).not.toHaveProperty('originalName')
    expect(output.streamError).not.toHaveProperty('statusCode')
    expect(output.streamError).not.toHaveProperty('status')
  })

  it.each([undefined, 'ECONNRESET', 42])(
    '[22243 invariant] preserves the exact top-level errorMessage contract (%s)',
    (code) => {
      const error = Object.assign(new Error('boom'), { code })
      const reporter = vi.fn()
      const logger = new LoggerService()
      logger.setErrorReporter(reporter)
      logger.error('prefix', error)
      const projected = forwarded()[4][0]
      expect(projected).toStrictEqual({
        name: 'Error',
        errorMessage: 'boom',
        stack: error.stack,
        code: typeof code === 'string' ? code : undefined
      })
      expect(Object.keys(projected)).toStrictEqual(['name', 'errorMessage', 'stack', 'code'])
      expect(reporter.mock.calls[0][0]).toBe(error)
    }
  )

  it('[22243 RED] bounds recursive metadata without mutating its input', () => {
    const input: Record<string, unknown> = {}
    input.self = input
    const deep = { a: { b: { c: { d: { e: { f: 'hidden' } } } } } }
    new LoggerService().error('failed', input, deep)
    expect(forwarded()[4][0]).toStrictEqual({ self: '[Circular]' })
    expect(forwarded()[4][1]).toStrictEqual({ a: { b: { c: { d: { e: '[Truncated]' } } } } })
    expect(input.self).toBe(input)
  })

  it('[22243 invariant] strips force forwarding control metadata', () => {
    const logger = new LoggerService().withContext('test', { requestId: 'r1' })
    const reporter = vi.fn()
    logger.setErrorReporter(reporter)
    logger.error('failed', new Error('boom'), { logToMain: true })
    expect(forwarded()[4]).toHaveLength(1)
    expect(JSON.stringify(forwarded())).not.toContain('logToMain')
    expect(JSON.stringify(reporter.mock.calls)).not.toContain('logToMain')
  })
})
