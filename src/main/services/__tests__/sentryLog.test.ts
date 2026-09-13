import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    PreferenceService: { get: (key: string) => preferences[key] }
  })
})

import { loggerService } from '@logger'

import { attachSentryLogTransport } from '../sentry'

let detach: () => void
const drainLogs = () => new Promise((resolve) => setImmediate(resolve))

function setConsent(granted: boolean) {
  preferences['app.privacy.data_collection.enabled'] = granted
  preferences['app.privacy.policy_version'] = granted ? LATEST_PRIVACY_POLICY_VERSION : ''
}

beforeEach(() => {
  captureExceptionMock.mockReset()
  vi.stubEnv('DEV', false)
  setConsent(false)
  loggerService.getBaseLogger().clear()
  detach = attachSentryLogTransport()
})

afterEach(() => {
  detach()
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

  it('does not recapture renderer logs that are reported through the renderer SDK', async () => {
    setConsent(true)
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === IpcChannel.App_LogToMain)![1]
    const error = new TypeError('Render failed')
    const componentStack = '\n    at MessageList (app:///messages.js:20:3)'
    handler(
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
    vi.stubEnv('DEV', true)
    setConsent(true)
    loggerService.withContext('Translation').error('Failed', new Error('development error'))
    await drainLogs()
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('removes its transport on cleanup and does not duplicate it when reattached', async () => {
    const base = loggerService.getBaseLogger()
    expect(base.transports).toHaveLength(1)
    detach()
    expect(base.transports).toHaveLength(0)
    detach = attachSentryLogTransport()
    setConsent(true)
    loggerService.withContext('Translation').error('Failed', new Error('disk full'))
    await drainLogs()
    expect(base.transports).toHaveLength(1)
    expect(captureExceptionMock.mock.calls).toHaveLength(1)
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
