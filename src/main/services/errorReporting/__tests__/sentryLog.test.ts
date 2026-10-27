import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import winston from 'winston'

import { application } from '@application'
import { fileEntryService } from '@data/services/FileEntryService'
import { PersistenceListener, TerminalPersistenceError } from '@main/ai/streamManager/listeners/PersistenceListener'
import { BaseService } from '@main/core/lifecycle'
import { logFailure } from '@main/core/logger/logFailure'
import { ApiServer } from '@main/data/api/core/ApiServer'
import { messageTable } from '@main/data/db/schemas/message'
import { classifyDatabaseFailure } from '@main/data/failureFacts'
import { fileHandlers } from '@main/ipc/handlers/file'
import { FileEditService, FileManager } from '@main/services/file'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcChannel } from '@shared/IpcChannel'
import { AbsoluteFilePathSchema } from '@shared/types/file'
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
  it.each([
    {
      label: 'database full',
      error: Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' }),
      status: 500,
      reports: 1
    },
    {
      label: 'translated conflict',
      error: DataApiErrorFactory.conflict('Tag already exists'),
      status: 409,
      reports: 0
    }
  ])('lets the classified DataApi boundary own capture for $label', async ({ error, status, reports }) => {
    setConsent(true)
    const server: ApiServer = new (ApiServer as any)({
      '/tags': {
        POST: () => {
          throw error
        }
      }
    })

    const response = await server.handleRequest({ id: 'request', method: 'POST', path: '/tags' })
    await drainLogs()

    expect(response.status).toBe(status)
    expect(response.error?.reportingHandled).toBe(true)
    expect(captureExceptionMock.mock.calls).toHaveLength(reports)
    expect(captureEventMock.mock.calls).toHaveLength(0)
    if (reports) {
      const [reported, context] = captureExceptionMock.mock.calls[0]
      expect(reported).toMatchObject({ name: 'OperationError', message: 'sqlite_full' })
      expect(context.tags).toMatchObject({
        operation: 'data.request',
        'failure.kind': 'reliability',
        'failure.reason': 'sqlite_full'
      })
    }
  })

  it('keeps malformed stored message content local when terminal persistence fails', async () => {
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
    const privateContent = 'my diary'
    const listener = new PersistenceListener({
      topicId: 'topic',
      backend: {
        kind: 'sqlite',
        persistAssistant() {
          messageTable.data.mapFromDriverValue(privateContent)
        }
      },
      onPersistFailed: () => {}
    })

    await expect(
      listener.onDone({
        status: 'success',
        finalMessage: { id: 'message', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }
      })
    ).rejects.toBeInstanceOf(TerminalPersistenceError)
    await drainLogs()

    expect(lines.join('')).toContain(privateContent)
    expect(captureExceptionMock.mock.calls).toHaveLength(1)
    const [reported, context] = captureExceptionMock.mock.calls[0]
    expect(reported).toMatchObject({ name: 'OperationError', message: 'persistence_failed' })
    expect(reported.stack).toContain('    at ')
    expect(reported.stack).not.toContain(privateContent)
    expect(JSON.stringify(context)).not.toContain(privateContent)
    expect(context.tags).toMatchObject({
      operation: 'message.persist',
      'failure.kind': 'reliability',
      'failure.reason': 'persistence_failed'
    })
  })

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

describe('file reporting through IPC', () => {
  setupTestDatabase()
  let root: string
  let files: FileManager
  let editing: FileEditService
  const context = { senderId: 'editing-window' }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'file-reporting-'))
    await mkdir(path.join(root, 'managed'))
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const base = key === 'feature.files.data' ? path.join(root, 'managed') : root
      return filename ? path.join(base, filename) : base
    })
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: { id: 1 }
    } as Electron.BrowserWindow)
    files = new FileManager()
    editing = new FileEditService()
    MockApplicationUtils.setService('FileManager', files)
    MockApplicationUtils.setService('FileEditService', editing)
    await editing._doInit()
    setConsent(true)
  })

  afterEach(async () => {
    await editing._doDestroy()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('keeps a missing external file local when renaming by entry ID', async () => {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'note.md'))
    await writeFile(target, 'base')
    const entry = await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
    await rm(target)

    await expect(fileHandlers['file.rename']({ id: entry.id, newName: 'renamed' }, context)).rejects.toMatchObject({
      code: 'ENOENT',
      reportingHandled: true
    })
    await drainLogs()
    expect(captureExceptionMock.mock.calls).toHaveLength(0)
    expect(captureEventMock.mock.calls).toHaveLength(0)
    expect(fileEntryService.getById(entry.id)).toMatchObject({ name: entry.name, externalPath: target })
  })

  it.each(['internal', 'external'])('retains unexpected metadata faults when renaming an %s entry', async (origin) => {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'note.md'))
    await writeFile(target, 'base')
    const entry =
      origin === 'external'
        ? await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
        : await files.createInternalEntry({
            source: 'bytes',
            data: new TextEncoder().encode('base'),
            name: 'note',
            ext: 'md',
            cleanupPolicy: 'manual'
          })
    const error = new TypeError('metadata update failed')
    vi.spyOn(fileEntryService, origin === 'external' ? 'setExternalPathAndName' : 'update').mockImplementationOnce(
      () => {
        throw error
      }
    )
    await expect(fileHandlers['file.rename']({ id: entry.id, newName: 'renamed' }, context)).rejects.toBe(error)
    await drainLogs()
    expect(captureExceptionMock.mock.calls).toHaveLength(1)
    expect(captureEventMock.mock.calls).toHaveLength(0)
    expect(captureExceptionMock.mock.calls[0][1].tags['failure.kind']).toBe('defect')
    expect(fileEntryService.getById(entry.id).name).toBe(entry.name)
    expect(await readFile(files.getPhysicalPath(entry.id), 'utf8')).toBe('base')
  })

  it.each(
    ['single', 'batch'].flatMap((route) => ['path', 'external', 'internal'].map((origin) => ({ route, origin })))
  )('preserves $origin provenance for missing metadata through $route lookup', async ({ route, origin }) => {
    let target = AbsoluteFilePathSchema.parse(path.join(root, 'missing.md'))
    const healthyPath = AbsoluteFilePathSchema.parse(path.join(root, 'healthy.md'))
    await writeFile(target, 'base')
    await writeFile(healthyPath, 'base')
    let handle: FileHandle = { kind: 'path', path: target }
    if (origin !== 'path') {
      const entry =
        origin === 'external'
          ? await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
          : await files.createInternalEntry({
              source: 'bytes',
              data: new TextEncoder().encode('base'),
              name: 'managed',
              ext: 'md',
              cleanupPolicy: 'manual'
            })
      handle = { kind: 'entry', entryId: entry.id }
      target = files.getPhysicalPath(entry.id)
    }
    await rm(target)
    if (route === 'single') {
      await expect(fileHandlers['file.get_metadata'](handle, context)).resolves.toBeNull()
    } else {
      await expect(
        fileHandlers['file.batch_get_metadata'](
          {
            items: [
              { key: 'missing', handle },
              { key: 'healthy', handle: { kind: 'path', path: healthyPath } }
            ]
          },
          context
        )
      ).resolves.toMatchObject({ missing: null, healthy: { size: 4 } })
    }
    await drainLogs()
    expect(captureExceptionMock.mock.calls).toHaveLength(origin === 'internal' ? 1 : 0)
    expect(captureEventMock.mock.calls).toHaveLength(0)
    if (origin === 'internal') {
      const [reported, sentryContext] = captureExceptionMock.mock.calls[0]
      expect(reported.message).toBe('enoent')
      expect(sentryContext.tags['failure.kind']).toBe('reliability')
      expect(JSON.stringify(sentryContext)).not.toContain(target)
    }
  })

  it.each([
    { origin: 'path', operation: 'open' },
    { origin: 'path', operation: 'read' },
    { origin: 'path', operation: 'write' },
    { origin: 'external', operation: 'open' },
    { origin: 'external', operation: 'read' },
    { origin: 'external', operation: 'write' },
    { origin: 'internal', operation: 'open' },
    { origin: 'internal', operation: 'read' },
    { origin: 'internal', operation: 'write' }
  ])('preserves $origin provenance when a missing file fails $operation', async ({ origin, operation }) => {
    let target = AbsoluteFilePathSchema.parse(path.join(root, 'note.md'))
    await writeFile(target, 'base')
    let handle: FileHandle = { kind: 'path', path: target }
    if (origin !== 'path') {
      const entry =
        origin === 'external'
          ? await files.ensureExternalEntry({ externalPath: target, cleanupPolicy: 'manual' })
          : await files.createInternalEntry({
              source: 'bytes',
              data: new TextEncoder().encode('base'),
              name: 'note',
              ext: 'md',
              cleanupPolicy: 'manual'
            })
      handle = { kind: 'entry', entryId: entry.id }
      target = files.getPhysicalPath(entry.id)
    }
    const resource = operation === 'open' ? undefined : await fileHandlers['file.edit.open']({ handle }, context)
    const snapshot = resource ? await fileHandlers['file.edit.read'](resource, context) : undefined
    await rm(target)
    const result =
      operation === 'open'
        ? fileHandlers['file.edit.open']({ handle }, context)
        : operation === 'read'
          ? fileHandlers['file.edit.read'](resource!, context)
          : fileHandlers['file.edit.write'](
              { editId: resource!.editId, expected: snapshot!.baseline, data: new TextEncoder().encode('new') },
              context
            )
    await expect(result).rejects.toMatchObject({ code: fileErrorCodes.EDIT_MISSING, reportingHandled: true })
    await drainLogs()
    expect(captureExceptionMock.mock.calls).toHaveLength(origin === 'internal' ? 1 : 0)
    expect(captureEventMock.mock.calls).toHaveLength(0)
    if (origin === 'internal') {
      const [reported, sentryContext] = captureExceptionMock.mock.calls[0]
      expect(reported.message).toBe('file_edit_missing')
      expect(sentryContext.tags['failure.kind']).toBe('reliability')
      expect(JSON.stringify(sentryContext)).not.toContain(target)
    }
  })
})
