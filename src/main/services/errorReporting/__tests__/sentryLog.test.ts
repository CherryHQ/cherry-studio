import { Writable } from 'node:stream'

import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import winston from 'winston'

import { BaseService } from '@main/core/lifecycle'
import { logFailure } from '@main/core/logger/logFailure'
import { classifyDatabaseFailure } from '@main/data/failureFacts'
import { IpcChannel } from '@shared/IpcChannel'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const { captureExceptionMock, captureEventMock, preferences, tmpLogsDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const preferences: Record<string, unknown> = {}
  return {
    captureExceptionMock: vi.fn(),
    captureEventMock: vi.fn(),
    preferences,
    tmpLogsDir: mkdtempSync(join(tmpdir(), 'sentry-log-test-')) as string
  }
})

vi.unmock('@logger')
vi.unmock('winston')
vi.unmock('winston-daily-rotate-file')
vi.mock('@main/core/paths/constants', () => ({ LOGS_DIR: tmpLogsDir }))
vi.mock('@sentry/electron/main', () => ({ captureException: captureExceptionMock, captureEvent: captureEventMock }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      isReady: true,
      get: (key: string) => preferences[key],
      subscribeChange: () => () => {}
    }
  })
})

import { loggerService } from '@logger'

import { AnalyticsService } from '../../AnalyticsService'
import { ErrorReportingService } from '../ErrorReportingService'

// LoggerService registers this handler when @logger is imported; clearMocks wipes that call before each test.
const logToMainHandler = vi
  .mocked(ipcMain.handle)
  .mock.calls.find(([channel]) => channel === IpcChannel.App_LogToMain)![1]

let service: ErrorReportingService
const drainLogs = () => new Promise((resolve) => setImmediate(resolve))

function setConsent(granted: boolean) {
  preferences['app.privacy.data_collection.enabled'] = granted
  preferences['app.privacy.policy_version'] = granted ? LATEST_PRIVACY_POLICY_VERSION : ''
}

beforeEach(async () => {
  BaseService.resetInstances()
  captureExceptionMock.mockReset()
  captureEventMock.mockReset()
  vi.stubEnv('DEV', false)
  setConsent(false)
  loggerService.getBaseLogger().clear()
  loggerService.getBaseLogger().add(new winston.transports.Console({ silent: true }))
  service = new ErrorReportingService()
  await service._doInit()
})

afterEach(async () => {
  await service._doDestroy()
  vi.unstubAllEnvs()
})

describe('Sentry log reporting', () => {
  it('keeps SQL and parameters local while reporting a database failure only once', async () => {
    setConsent(true)
    const lines: string[] = []
    loggerService.getBaseLogger().add(
      new winston.transports.Stream({
        stream: new Writable({
          write(chunk, _encoding, callback) {
            lines.push(chunk.toString())
            callback()
          }
        })
      })
    )
    const error = new Error('Failed query: INSERT secret SQL; params: private-document', {
      cause: Object.assign(new Error('database damaged'), { code: 'SQLITE_CORRUPT' })
    })
    const logger = loggerService.withContext('DataApi:Server')
    logFailure(logger, 'Request failed', error, 'data.request', classifyDatabaseFailure(error))
    logFailure(logger, 'Request failed again', error, 'data.request', classifyDatabaseFailure(error))
    await drainLogs()

    expect(captureExceptionMock.mock.calls).toHaveLength(1)
    const [reported, context] = captureExceptionMock.mock.calls[0]
    expect(reported.message).toBe('sqlite_corrupt')
    expect(reported.stack).not.toMatch(/secret SQL|private-document/)
    expect(JSON.stringify(context)).not.toMatch(/secret SQL|private-document/)
    expect(context.tags['failure.kind']).toBe('reliability')
    expect(lines.join('')).toContain('private-document')
    expect(service.filterEvent({ type: undefined }, { originalException: error })).toBeNull()
  })

  it('writes a report reference to local logs without reporting that reference again', async () => {
    setConsent(true)
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString())
        callback()
      }
    })
    loggerService.getBaseLogger().add(new winston.transports.Stream({ stream }))
    const event = service.filterEvent({ type: undefined, message: 'private provider response' })
    await drainLogs()
    expect(event?.event_id).toMatch(/^[a-f0-9]{32}$/)
    const output = lines.join('')
    expect(output).toContain(event!.event_id)
    expect(output).not.toContain('private provider response')
    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(captureEventMock).not.toHaveBeenCalled()
  })
  it('captures structured crashes without a stack and keeps expected SDK failures local', async () => {
    setConsent(true)
    const logger = loggerService.withContext('Runtime')
    logger.error('Output limit', new Error('limit'), {
      failure: {
        source: 'sdk',
        kind: 'expected',
        reason: 'output_limit',
        outcome: 'failed',
        runtime: 'pi'
      }
    })
    logger.error('Renderer exited', {
      operation: 'window.renderer.exit',
      failure: {
        source: 'application',
        kind: 'reliability',
        reason: 'crashed',
        outcome: 'failed'
      }
    })
    await drainLogs()
    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(captureEventMock.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        message: 'window.renderer.exit',
        tags: expect.objectContaining({ 'failure.reason': 'crashed' })
      })
    ])
  })

  it('reports handled main errors only while consent is enabled', async () => {
    const logger = loggerService.withContext('JobManager', { prompt: 'private conversation' })
    const error = Object.assign(new TypeError('Cannot enqueue job'), { code: 'JOB_PAYLOAD_TOO_LARGE' })

    logger.error('Failed to enqueue schedule', error, { scheduleId: 'private-id' })
    await drainLogs()
    expect(captureExceptionMock).not.toHaveBeenCalled()

    setConsent(true)
    logger.error('Failed to enqueue schedule', error, { scheduleId: 'private-id' })
    await drainLogs()
    expect(captureExceptionMock.mock.calls).toHaveLength(1)
    const [reported, context] = captureExceptionMock.mock.calls[0]
    expect(reported).toMatchObject({ name: 'TypeError', message: error.message, stack: error.stack })
    expect(context).toEqual({
      tags: { module: 'JobManager', code: 'JOB_PAYLOAD_TOO_LARGE', 'event.process': 'main', 'capture.source': 'log' },
      extra: undefined
    })

    setConsent(false)
    logger.error('Failed to enqueue schedule', error)
    await drainLogs()
    expect(captureExceptionMock.mock.calls).toHaveLength(1)
  })

  it('reports the bounded, redacted message produced by the main logger', async () => {
    setConsent(true)
    const error = new Error(`details apiKey = sk-secret123\n${'diagnostic '.repeat(1000)}`)
    loggerService.withContext('Translation').error('Failed', error)
    await drainLogs()

    const [reported] = captureExceptionMock.mock.calls[0]
    expect(reported.message).not.toContain('sk-secret123')
    expect(reported.message).toContain('details')
    expect(reported.message.length).toBeLessThanOrEqual(501)
    expect(reported.stack.length).toBeLessThanOrEqual(4000)
  })

  it('does not recapture renderer logs that are reported through the renderer SDK', async () => {
    setConsent(true)
    const error = new TypeError('Render failed')
    const componentStack = '\n    at MessageList (app:///messages.js:20:3)'
    logToMainHandler(
      {} as Electron.IpcMainInvokeEvent,
      { process: 'renderer', window: 'main', module: 'ErrorBoundary', context: { apiKey: 'secret' } },
      'error',
      'Caught a render error',
      structuredClone([
        { name: error.name, errorMessage: error.message, stack: error.stack },
        { componentStack, prompt: 'private conversation' }
      ])
    )
    await drainLogs()

    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('ignores ordinary logs, cancellation, and telemetry diagnostic errors', async () => {
    setConsent(true)
    const logger = loggerService.withContext('Translation')
    logger.info('Started', new Error('not a failure'))
    logger.warn('Retrying', new Error('temporary failure'))
    logger.error('Status text without exception')
    logger.error('Cancelled', Object.assign(new Error('cancelled'), { name: 'AbortError' }))
    logger.error('Cancelled', Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' }))
    loggerService.withContext('Sentry').error('Fatal main-process error', new Error('already captured'))
    loggerService.withContext('CrashTelemetry').error('Uncaught Exception', new Error('already captured'))
    await drainLogs()
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('does not capture development errors even with consent enabled', async () => {
    await service._doStop()
    vi.stubEnv('DEV', true)
    await service._doInit()
    setConsent(true)
    loggerService.withContext('Translation').error('Failed', new Error('development error'))
    await drainLogs()
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('stops reporting on stop and reports once per error after restart', async () => {
    setConsent(true)
    const logger = loggerService.withContext('Translation')
    logger.error('Failed', new Error('before stop'))
    await drainLogs()
    await service._doStop()
    logger.error('Failed', new Error('while stopped'))
    await drainLogs()
    await service._doInit()
    logger.error('Failed', new Error('after restart'))
    await drainLogs()
    expect(captureExceptionMock.mock.calls.map(([error]) => error.message)).toEqual(['before stop', 'after restart'])
  })

  it('removes the bridge when destroyed without a preceding stop', async () => {
    setConsent(true)
    await service._doDestroy()
    loggerService.withContext('Translation').error('Failed', new Error('after destroy'))
    await drainLogs()
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('reports independently of AnalyticsService initialization and shutdown', async () => {
    const analytics = new AnalyticsService()
    await analytics._doInit()
    try {
      setConsent(true)
      const logger = loggerService.withContext('Translation')
      logger.error('Failed', new Error('before analytics stop'))
      await drainLogs()
      await analytics._doStop()
      logger.error('Failed', new Error('after analytics stop'))
      await drainLogs()
      expect(captureExceptionMock.mock.calls.map(([error]) => error.message)).toEqual([
        'before analytics stop',
        'after analytics stop'
      ])
    } finally {
      await analytics._doDestroy()
    }
  })

  it('keeps logging usable if the SDK throws during capture', async () => {
    setConsent(true)
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error('SDK unavailable')
    })
    const logger = loggerService.withContext('Translation')
    logger.error('Failed', new Error('first'))
    logger.error('Failed', new Error('second'))
    await drainLogs()
    expect(captureExceptionMock.mock.calls.map(([error]) => error.message)).toEqual(['first', 'second'])
  })
})
