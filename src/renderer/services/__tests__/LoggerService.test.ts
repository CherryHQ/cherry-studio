import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'

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
})

// `logToMain` defaults to WARN, so the `info` lines that name who asked for a stream
// abort never reach main's `app.log` on a packaged build. This is the escape hatch those
// call sites rely on; if it stops forcing, they go silent again without a failing test.
describe('LoggerService forced forwarding to main', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="logger-window-source" content="mainWindow" />'
    // The stubbed bridge is one shared vi.fn for the whole file; clear it so "never
    // forwarded" means this test's logger, not an empty history.
    vi.spyOn(window.electron.ipcRenderer, 'invoke').mockResolvedValue(undefined).mockClear()
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps an unmarked info line out of main at the default threshold', () => {
    new LoggerService().info('Stream abort requested', { topicId: 'agent-session:session-1' })

    expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('forwards a marked info line to main without the marker in the payload', () => {
    new LoggerService().info('Stream abort requested', { topicId: 'agent-session:session-1' }, { logToMain: true })

    const call = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls.at(-1)!
    expect(call[0]).toBe(IpcChannel.App_LogToMain)
    expect(call[3]).toBe('Stream abort requested')
    expect(call[4]).toEqual([{ topicId: 'agent-session:session-1' }])
  })
})

/**
 * `processLog` applies the `CSLOGGER_RENDERER_*` filters and the instance level check
 * before it reads the force marker, so `{ logToMain: true }` forces a line past the
 * `logToMain` threshold but not past those. This pins that ordering: the abort
 * attribution lines reach `app.log` on a packaged build, and the diagnostics overrides
 * can still suppress them. Reordering `processLog` would change this — deliberately a
 * separate decision, since the filters are shared by every renderer log call.
 */
describe('LoggerService diagnostic filters run before the force marker', () => {
  const originalElectron = window.electron

  beforeEach(() => {
    document.head.innerHTML = ''
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: originalElectron })
    vi.restoreAllMocks()
    vi.resetModules()
  })

  /** Loads a fresh LoggerService: DEV_LOGGING and the env overrides are read at import. */
  async function loadLoggerWithEnv(env: Record<string, string>) {
    vi.resetModules()
    const invoke = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: { process: { env }, ipcRenderer: { on: vi.fn(), send: vi.fn(), invoke } }
    })
    const actual = await vi.importActual<typeof LoggerModule>('../LoggerService')
    const logger = new actual.LoggerService()
    logger.initWindowSource('mainWindow')
    return { logger, invoke }
  }

  it('delivers a forced info line on a packaged build but drops it when CSLOGGER_RENDERER_LEVEL excludes it', async () => {
    const packaged = await loadLoggerWithEnv({})
    packaged.logger.info('Stream abort requested', { topicId: 'agent-session:session-1' }, { logToMain: true })

    expect(packaged.invoke).toHaveBeenCalledWith(
      IpcChannel.App_LogToMain,
      expect.objectContaining({ process: 'renderer', window: 'mainWindow' }),
      'info',
      'Stream abort requested',
      [{ topicId: 'agent-session:session-1' }]
    )

    const filtered = await loadLoggerWithEnv({ CS_DIAGNOSTICS: '1', CSLOGGER_RENDERER_LEVEL: 'warn' })
    filtered.logger.info('Stream abort requested', { topicId: 'agent-session:session-1' }, { logToMain: true })

    expect(filtered.invoke).not.toHaveBeenCalled()
  })
})
