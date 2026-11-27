import { Writable } from 'node:stream'

import { APICallError, RetryError } from 'ai'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import winston from 'winston'

import { IpcChannel } from '@shared/IpcChannel'
import type { LogSourceWithContext } from '@shared/types/logger'

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
    // small diagnostic tags survive; fat fields never reach disk (#20363)
    expect(line).toHaveProperty('code', 'EFAKE')
    expect(lines[0]).toContain('EFAKE')
  })

  it('drops unbounded custom props from Error file output', async () => {
    const { loggerService, lines, readLine } = await loadLogger()
    const error = Object.assign(new Error('No available channel'), {
      requestBodyValues: { messages: [{ content: 'private prompt '.repeat(100_000) }] },
      responseBody: 'private tool results '.repeat(100_000),
      responseHeaders: { 'set-cookie': 'session=secret' }
    })
    loggerService.withContext('AiTest').error('model call failed after retries', error)

    const line = await readLine()
    expect(line).not.toHaveProperty('requestBodyValues')
    expect(line).not.toHaveProperty('responseBody')
    expect(line).not.toHaveProperty('responseHeaders')
    expect(JSON.stringify(line).length).toBeLessThan(10_240)
    expect(lines[0]).not.toContain('private prompt')
  })

  it('drops nested error payloads from Error file output', async () => {
    const { loggerService, readLine } = await loadLogger()
    const nested = Object.assign(new Error('channel error'), {
      requestBodyValues: { messages: [{ content: 'nested private prompt' }] },
      responseBody: 'nested private results'
    })
    const error = new Error('Failed after retries', { cause: nested })
    loggerService.withContext('AiTest').error('model call failed after retries', error)

    const line = await readLine()
    expect(line).not.toHaveProperty('requestBodyValues')
    expect(line).not.toHaveProperty('cause')
    expect(JSON.stringify(line)).not.toContain('nested private')
  })

  it('bounds file output for Errors with huge messages', async () => {
    const { loggerService, readLine } = await loadLogger()
    loggerService.withContext('AiTest').error('boom', new Error('huge '.repeat(20_000)))

    const line = await readLine()
    expect(String(line.message).length).toBeLessThan(2048)
    expect(String(line.stack).length).toBeLessThanOrEqual(4000)
  })

  it('bounds and redacts error names before writing file logs', async () => {
    const { loggerService, lines, readLine } = await loadLogger()
    const longName = new Error('boom')
    longName.name = 'n'.repeat(500)
    loggerService.withContext('AiTest').error('boom', longName)
    const secretName = new Error('boom')
    secretName.name = 'apiKey = sk-secret123'
    loggerService.withContext('AiTest').error('boom', secretName)

    expect(String((await readLine(0)).name).length).toBeLessThanOrEqual(100)
    const secretLine = await readLine(1)
    expect(String(secretLine.name)).not.toContain('sk-secret123')
    expect(lines[1]).not.toContain('sk-secret123')
  })

  it('keeps diagnostic tags from real APICallError while stripping fat fields', async () => {
    const { loggerService, lines, readLine } = await loadLogger()
    const error = new APICallError({
      message: 'No available channel',
      url: 'https://api.example.com/chat?token=url-secret',
      requestBodyValues: { messages: [{ content: 'private prompt '.repeat(100_000) }] },
      statusCode: 503,
      responseHeaders: { 'set-cookie': 'session=secret' },
      responseBody: 'private tool results '.repeat(100_000),
      data: { apiKey: 'data-secret' },
      isRetryable: true
    })
    loggerService.withContext('AiTest').error('model call failed after retries', error)

    const line = await readLine()
    expect(line).toMatchObject({ name: 'AI_APICallError', statusCode: 503, isRetryable: true })
    expect(line).not.toHaveProperty('requestBodyValues')
    expect(line).not.toHaveProperty('responseBody')
    expect(line).not.toHaveProperty('responseHeaders')
    expect(line).not.toHaveProperty('data')
    expect(JSON.stringify(line).length).toBeLessThan(10_240)
    expect(lines[0]).not.toContain('private prompt')
    expect(lines[0]).not.toContain('url-secret')
  })

  it('strips nested RetryError payloads from file output', async () => {
    const { loggerService, readLine } = await loadLogger()
    const terminal = new APICallError({
      message: 'provider concurrency limit reached',
      url: 'https://api.example.com/chat',
      requestBodyValues: { prompt: 'nested private prompt' },
      statusCode: 429,
      responseHeaders: {},
      responseBody: 'nested private results',
      isRetryable: true
    })
    const error = new RetryError({ message: 'Failed after retries', reason: 'maxRetriesExceeded', errors: [terminal] })
    loggerService.withContext('AiTest').error('model call failed after retries', error)

    const line = await readLine()
    expect(line).toMatchObject({ name: 'AI_RetryError', reason: 'maxRetriesExceeded' })
    expect(line).not.toHaveProperty('errors')
    expect(line).not.toHaveProperty('lastError')
    expect(line).not.toHaveProperty('cause')
    expect(JSON.stringify(line)).not.toContain('nested private')
  })

  it('redacts secrets from error messages before writing file logs', async () => {
    const { loggerService, lines, readLine } = await loadLogger()
    loggerService.withContext('AiTest').error('boom', new Error('request failed: apiKey = sk-secret123'))

    const line = await readLine()
    expect(String(line.message)).not.toContain('sk-secret123')
    expect(lines[0]).not.toContain('sk-secret123')
  })

  it('sanitizes Errors nested in later metadata and context objects', async () => {
    const { loggerService, lines, readLine } = await loadLogger()
    const fat = Object.assign(new Error('channel error'), {
      requestBodyValues: { messages: [{ content: 'nested private prompt' }] }
    })
    loggerService
      .withContext('AiTest', { contextError: fat })
      .error('boom', { requestId: 'r1', nestedError: fat }, { requestId: 'r2' })

    const line = await readLine()
    expect(lines[0]).toContain('r1')
    expect(lines[0]).toContain('r2')
    expect(JSON.stringify(line)).not.toContain('nested private prompt')
    const nested = line.nestedError as Record<string, unknown>
    expect(nested).toMatchObject({ name: 'Error', message: 'channel error' })
    expect(nested).not.toHaveProperty('requestBodyValues')
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
