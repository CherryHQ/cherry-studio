import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import winston from 'winston'

import { BaseService } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const { captureExceptionMock, preferences, tmpLogsDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const preferences: Record<string, unknown> = {}
  return {
    captureExceptionMock: vi.fn(),
    preferences,
    tmpLogsDir: mkdtempSync(join(tmpdir(), 'sentry-log-test-')) as string
  }
})

vi.unmock('@logger')
vi.unmock('winston')
vi.unmock('winston-daily-rotate-file')
vi.mock('@main/core/paths/constants', () => ({ LOGS_DIR: tmpLogsDir }))
vi.mock('@sentry/electron/main', () => ({ captureException: captureExceptionMock }))
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

import { AnalyticsService } from '../AnalyticsService'
import { SentryLogService } from '../SentryLogService'

// LoggerService registers this handler when @logger is imported; clearMocks wipes that call before each test.
const logToMainHandler = vi
  .mocked(ipcMain.handle)
  .mock.calls.find(([channel]) => channel === IpcChannel.App_LogToMain)![1]

let service: SentryLogService
const drainLogs = () => new Promise((resolve) => setImmediate(resolve))

function setConsent(granted: boolean) {
  preferences['app.privacy.data_collection.enabled'] = granted
  preferences['app.privacy.policy_version'] = granted ? LATEST_PRIVACY_POLICY_VERSION : ''
}

beforeEach(async () => {
  BaseService.resetInstances()
  captureExceptionMock.mockReset()
  vi.stubEnv('DEV', false)
  setConsent(false)
  loggerService.getBaseLogger().clear()
  loggerService.getBaseLogger().add(new winston.transports.Console({ silent: true }))
  service = new SentryLogService()
  await service._doInit()
})

afterEach(async () => {
  await service._doDestroy()
  vi.unstubAllEnvs()
})

describe('Sentry log reporting', () => {
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
      tags: { module: 'JobManager', code: 'JOB_PAYLOAD_TOO_LARGE', 'event.process': 'main' },
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
