import { Writable } from 'node:stream'

import { IpcChannel } from '@shared/IpcChannel'
import type { LogSourceWithContext } from '@shared/types/logger'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import winston from 'winston'

const tmpLogsDir = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return mkdtempSync(join(tmpdir(), 'logger-service-test-')) as string
})

const flags = vi.hoisted(() => ({ dev: false }))

// the global setup mocks '@logger' (this very file) and winston — undo both to test the real implementation
vi.unmock('@logger')
vi.unmock('winston')
vi.unmock('winston-daily-rotate-file')
vi.mock('@main/core/paths/constants', () => ({ LOGS_DIR: tmpLogsDir }))
vi.mock('@main/core/platform', () => ({
  get isDev() {
    return flags.dev
  }
}))

/**
 * Loads a fresh module graph so DEV_LOGGING (computed at import time) reflects
 * the current `flags.dev`, and swaps the file transports for an in-memory sink.
 */
async function loadLogger() {
  vi.resetModules()
  const { loggerService } = await import('../LoggerService')
  const lines: string[] = []
  const base = loggerService.getBaseLogger()
  base.clear()
  base.add(
    new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _encoding, callback) {
          lines.push(String(chunk))
          callback()
        }
      })
    })
  )
  const readLine = async (index = 0): Promise<Record<string, unknown>> => {
    await new Promise((resolve) => setImmediate(resolve))
    return JSON.parse(lines[index])
  }
  return { loggerService, lines, readLine }
}

function invalidUrlError(url: string, base?: string): Error {
  try {
    new URL(url, base)
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error(`Expected URL parsing to fail for ${url}`)
}

describe('LoggerService file output', () => {
  beforeEach(() => {
    flags.dev = false
  })

  it('keeps module/process when the call carries data arguments', async () => {
    const { loggerService, lines, readLine } = await loadLogger()
    const error = Object.assign(new Error('io fail'), { code: 'EFAKE' })
    loggerService.withContext('ScanTest').error('boom', error, { requestId: 'r1' })

    const line = await readLine()
    expect(line.module).toBe('ScanTest')
    expect(line.process).toBe('main')
    expect(line.level).toBe('error')
    expect(String(line.message)).toContain('boom')
    expect(String(line.stack)).toContain('io fail')
    // caller data must survive to disk, wherever it nests
    expect(lines[0]).toContain('r1')
    expect(lines[0]).toContain('EFAKE')
  })

  it.each(['message', 'input', 'stack', 'nested error', 'array', 'tail'])(
    'redacts URL credentials in %s at the file output',
    async (position) => {
      const { loggerService, lines, readLine } = await loadLogger()
      const url = 'http://u:hunter2@host:abc'
      const redacted = 'http://<redacted>:<redacted>@host:abc'
      const lastFrame = `    at ${'x'.repeat(350)} (worker.ts:42:7)`
      const error = invalidUrlError(url)
      error.stack = `Error: Failed ${url}\n${lastFrame}`

      switch (position) {
        case 'message':
          loggerService.error(`Failed ${url}`)
          break
        case 'input':
        case 'stack':
          loggerService.error('Invalid proxy', error)
          break
        case 'nested error':
          loggerService.error('Invalid proxy', { error })
          break
        case 'array':
          loggerService.error('Invalid proxy', { urls: [url] })
          break
        case 'tail':
          loggerService.error('Invalid proxy', { requestId: 'r1' }, { url }, error)
          break
      }

      const line = await readLine()
      expect(lines[0]).not.toContain('hunter2')
      if (position === 'message') expect(line.message).toBe(`Failed ${redacted}`)
      if (position === 'input' || position === 'stack') {
        expect(line.code).toBe('ERR_INVALID_URL')
        expect(line.input).toBe(redacted)
        expect(line.stack).toBe(`Error: Failed ${redacted}\n${lastFrame}`)
      }
      if (position === 'nested error') {
        expect(line.error).toEqual({ code: 'ERR_INVALID_URL', input: redacted })
      }
      if (position === 'array') expect(line.urls).toEqual([redacted])
      if (position === 'tail') {
        expect(line.data).toEqual([
          { url: redacted },
          { name: 'TypeError', message: 'Invalid URL', stack: `Error: Failed ${redacted}\n${lastFrame}` }
        ])
      }
    }
  )

  it('preserves JSON serialization and long info values while redacting toJSON output', async () => {
    const { loggerService, lines, readLine } = await loadLogger()
    const url = 'http://u:hunter2@host'
    const circular: Record<string, unknown> = { url }
    circular.self = circular
    const data = {
      long: 'x'.repeat(1_000),
      count: 9007199254740993n,
      circular,
      custom: { toJSON: () => url }
    }

    loggerService.info('Details', data)

    const line = await readLine()
    expect(line.long).toBe(data.long)
    expect(line.count).toBe('9007199254740993')
    expect(line.circular).toEqual({ url: 'http://<redacted>:<redacted>@host', self: '[Circular]' })
    expect(line.custom).toBe('http://<redacted>:<redacted>@host')
    expect(lines[0]).not.toContain('hunter2')
    expect(circular.url).toBe(url)
    expect(circular.self).toBe(circular)
    expect(data.custom.toJSON()).toBe(url)
  })

  it.each(['input', 'base', 'nested error'])(
    'redacts a password containing a path character in ERR_INVALID_URL %s',
    async (position) => {
      const { loggerService, lines, readLine } = await loadLogger()
      const url = 'http://user:ab/cd@proxy:8080'
      const error = position === 'base' ? invalidUrlError('/path', url) : invalidUrlError(url)

      if (position === 'nested error') loggerService.error('Invalid proxy', { error })
      else loggerService.error('Invalid proxy', error)

      const line = await readLine()
      const holder = position === 'nested error' ? (line.error as Record<string, unknown>) : line
      expect(lines[0]).not.toContain('ab/cd')
      expect(holder.code).toBe('ERR_INVALID_URL')
      expect(holder[position === 'base' ? 'base' : 'input']).toBe('http://<redacted>:<redacted>@proxy:8080')
    }
  )

  it('leaves input fields outside ERR_INVALID_URL untouched', async () => {
    const { loggerService, readLine } = await loadLogger()
    const input = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.0.0/dist/standalone.js'

    loggerService.info('Tool call', { input })

    expect((await readLine()).input).toBe(input)
  })

  it('adds sys/appver on warn and error but not on info', async () => {
    const { loggerService, readLine } = await loadLogger()
    const logger = loggerService.withContext('SysTest')
    logger.error('e1')
    logger.info('i1')

    const errorLine = await readLine(0)
    expect(errorLine.sys).toBeDefined()
    expect(typeof errorLine.appver).toBe('string')
    expect(errorLine.appver).not.toBe('')

    const infoLine = await readLine(1)
    expect(infoLine.module).toBe('SysTest')
    expect(infoLine).not.toHaveProperty('sys')
    expect(infoLine).not.toHaveProperty('appver')
  })

  it('writes timestamps that diagnostic collectors can parse', async () => {
    const { loggerService, readLine } = await loadLogger()
    loggerService.withContext('TsTest').warn('w1')

    const line = await readLine()
    // sourceCollector.parseLineTimestamp parses via `timestamp.replace(' ', 'T')`
    const parsed = Date.parse(String(line.timestamp).replace(' ', 'T'))
    expect(Number.isFinite(parsed)).toBe(true)
  })

  it('preserves renderer window/module when the forwarded log carries data', async () => {
    const { readLine, lines } = await loadLogger()
    const calls = vi.mocked(ipcMain.handle).mock.calls
    const handler = calls.filter(([channel]) => channel === IpcChannel.App_LogToMain).at(-1)?.[1] as (
      event: unknown,
      source: LogSourceWithContext,
      level: string,
      message: string,
      data: unknown[]
    ) => void
    expect(handler).toBeDefined()

    handler(null, { process: 'renderer', window: 'w1', module: 'RM' }, 'error', 'renderer boom', [{ topicId: 't1' }])

    const line = await readLine()
    expect(line.process).toBe('renderer')
    expect(line.window).toBe('w1')
    expect(line.module).toBe('RM')
    expect(lines[0]).toContain('t1')
  })

  it('keeps dev console output limited to caller data', async () => {
    flags.dev = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { loggerService } = await loadLogger()
      loggerService.withContext('ConsoleTest').error('boom', { secret: 's1' })

      const call = consoleError.mock.calls.at(-1)
      expect(call).toBeDefined()
      const [, ...metaArgs] = call!
      expect(metaArgs).toEqual([{ secret: 's1' }])
    } finally {
      consoleError.mockRestore()
    }
  })
})
