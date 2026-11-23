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
    // oxlint-disable-next-line no-restricted-globals -- Isolate synthetic fixture data from later test mutations.
    const [serialized] = structuredClone(call[4])
    expect(serialized).toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
      errorMessage: 'User cancelled',
      stack: error.stack
    })
  })
  it('projects every Error to the existing wire fields while preserving console and observer identity', () => {
    const logger = new LoggerService().initWindowSource('capture')
    const observer = vi.fn()
    logger.setErrorReporter(observer)
    const error = Object.assign(new Error('first failure'), {
      code: 'ERR_TEST',
      reportingHandled: true,
      callback: () => {}
    })
    const later = new Error('later failure')
    logger.error('operation', error, { nested: later }, later)

    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!
    // oxlint-disable-next-line no-restricted-globals -- Exercise the IPC clone requirement on the actual projected envelope.
    const envelope = structuredClone(call.slice(1))
    const data = envelope[3]
    expect(Object.keys(data[0]).sort()).toEqual(['code', 'errorMessage', 'name', 'reportingHandled', 'stack'])
    expect(data[0]).toMatchObject({ code: 'ERR_TEST', errorMessage: 'first failure', reportingHandled: true })
    expect(data[1].nested).toMatchObject({ name: 'Error', message: 'later failure' })
    expect(data[2]).toMatchObject({ name: 'Error', errorMessage: 'later failure' })
    expect(observer.mock.calls[0][0].error).toBe(error)
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[3]).toBe(error)
  })

  it('sends cloneable unknown diagnostics and context while retaining valid fields', () => {
    const cycle: { self?: object } = {}
    cycle.self = cycle
    const unreadable = {
      get value() {
        throw new Error('unreadable')
      }
    }
    const logger = new LoggerService().initWindowSource('capture').withContext('boundary', {
      valid: 'context',
      callback: () => {},
      cycle,
      unreadable
    })
    logger.warn('operation', { valid: 'data', symbol: Symbol(), integer: 1n, cycle }, unreadable)

    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!
    // oxlint-disable-next-line no-restricted-globals -- Verify that no raw unsupported value remains anywhere in the IPC envelope.
    const [source, , , data] = structuredClone(call.slice(1))
    expect(source.context).toEqual({
      valid: 'context',
      callback: '<redacted>',
      cycle: { self: '[Circular]' },
      unreadable: '<redacted>'
    })
    expect(data).toEqual([
      { valid: 'data', symbol: '<redacted>', integer: '<redacted>', cycle: { self: '[Circular]' } },
      '<redacted>'
    ])
  })

  it('keeps empty, undefined, null and string diagnostic positions distinct', () => {
    const logger = new LoggerService().initWindowSource('capture')
    logger.error('empty')
    logger.error('undefined', undefined)
    logger.error('null', null)
    logger.error('string', 'diagnostic')

    expect(vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.map((call) => call[4])).toEqual([
      [],
      [undefined],
      [null],
      ['diagnostic']
    ])
  })

  it('strips the raw force-send marker and retains severity filtering', () => {
    const logger = new LoggerService().initWindowSource('capture')
    logger.setLogToMainLevel('error')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    logger.warn('below threshold', { keep: true })
    logger.info('forced', { keep: true }, { logToMain: true })

    const calls = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toBe('info')
    expect(calls[0][4]).toEqual([{ keep: true }])
  })

  it('does not let unreadable context, force markers or revoked proxies interrupt logging', () => {
    const base = new LoggerService().initWindowSource('capture').withContext('base', { valid: 'keep' })
    const logger = base.withContext('boundary', {
      get value() {
        throw new Error('unreadable')
      }
    })
    const marker = {
      get logToMain() {
        throw new Error('unreadable')
      }
    }
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => logger.warn('operation', proxy, marker)).not.toThrow()
    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!
    expect(call[1].context).toEqual({ valid: 'keep' })
    expect(call[4]).toEqual(['<redacted>', '<redacted>'])
  })

  it('honors virtual force-send getters without invoking a Proxy has trap', () => {
    const logger = new LoggerService().initWindowSource('capture')
    logger.setLogToMainLevel('error')
    const marker = new Proxy(
      {},
      {
        get: (_target, key) => (key === 'logToMain' ? true : undefined),
        has() {
          throw new Error('has is not a property read')
        }
      }
    )
    logger.warn('forced', marker)

    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!
    expect(call[2]).toBe('warn')
    expect(call[3]).toBe('forced')
    expect(call[4]).toEqual([])
  })

  it('reports projected diagnostics even when the original Error probe throws', () => {
    const logger = new LoggerService().initWindowSource('capture')
    const observer = vi.fn()
    logger.setErrorReporter(observer)
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    logger.error('operation', proxy, { failure: { code: 'ERR_TEST' } })

    const observation = observer.mock.calls[0][0]
    expect(observation.error).toBeUndefined()
    expect(observation.entry).toMatchObject({
      process: 'renderer',
      window: 'capture',
      level: 'error',
      data: ['<redacted>', { failure: { code: 'ERR_TEST' } }]
    })
  })

  it('isolates an error observer that throws an unreadable diagnostic', () => {
    const logger = new LoggerService().initWindowSource('capture')
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    logger.setErrorReporter(() => {
      throw proxy
    })

    expect(() => logger.error('operation', new Error('original failure'))).not.toThrow()
    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!
    expect(call[2]).toBe('warn')
    expect(call[3]).toBe('Failed to report logged error')
    expect(call[4]).toEqual(['<redacted>'])
  })

  it('preserves original Error reporting when IPC throws or rejects', async () => {
    const logger = new LoggerService().initWindowSource('capture')
    const observer = vi.fn()
    logger.setErrorReporter(observer)
    const error = new Error('original operation failed')
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke)
    invoke.mockImplementationOnce(() => {
      throw new Error('transport failed')
    })
    expect(() => logger.error('operation', error)).not.toThrow()
    invoke.mockRejectedValueOnce(new Error('transport failed'))
    expect(() => logger.error('operation', error)).not.toThrow()
    await Promise.resolve()

    expect(observer.mock.calls).toHaveLength(2)
    expect(observer.mock.calls[0][0].error).toBe(error)
    expect(observer.mock.calls[1][0].error).toBe(error)
  })
})
