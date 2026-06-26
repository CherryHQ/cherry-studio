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

  it('returns the logger from initWindowSource to support chaining', () => {
    const logger = new LoggerService()

    expect(logger.initWindowSource('Worker')).toBe(logger)
  })
})
