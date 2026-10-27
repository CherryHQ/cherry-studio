import type { EventEmitter } from 'node:events'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService, LifecycleEvents, LifecycleState } from '@main/core/lifecycle'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const { captureExceptionMock, flushMock, lifecycle, strategies, handlerMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  flushMock: vi.fn(async () => true),
  lifecycle: new (require('node:events').EventEmitter)() as EventEmitter,
  strategies: new Map<string, string>(),
  handlerMock: vi.fn()
}))

vi.mock('@sentry/electron/main', () => ({ captureException: captureExceptionMock, flush: flushMock }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  const { MockMainDataApiServiceExport } = await import('@test-mocks/main/DataApiService')
  const { ApiServer } = await import('@main/data/api/core/ApiServer')
  const apiServer = new (ApiServer as any)({ '/providers': { GET: handlerMock } })
  const mock = mockApplicationFactory({
    PreferenceService: { ...MockMainPreferenceServiceExport.preferenceService, isReady: true },
    DataApiService: { ...MockMainDataApiServiceExport.dataApiService, getApiServer: () => apiServer }
  })
  Object.assign(mock.application.getContainer(), {
    getMetadata: (name: string) => ({ errorStrategy: strategies.get(name) })
  })
  return { ...mock, application: { ...mock.application, getLifecycleManager: () => lifecycle } }
})

import { application } from '@application'

import { SentryService } from '../SentryService'

let service: SentryService

beforeEach(async () => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
  vi.stubEnv('DEV', false)
  strategies.clear()
  strategies.set('MainWindowService', 'graceful')
  strategies.set('AnalyticsService', 'graceful')
  service = new SentryService()
  await service._doInit()
})

afterEach(async () => {
  await service._doDestroy()
  vi.unstubAllEnvs()
})

function fail(name: string, error: Error) {
  lifecycle.emit(LifecycleEvents.SERVICE_ERROR, { name, error, state: LifecycleState.Stopped })
}

describe('startup failure reporting', () => {
  it('reports main-window initialization failures despite its graceful strategy, leaving optional services local', () => {
    fail('AnalyticsService', new Error('fetch failed'))
    expect(captureExceptionMock).not.toHaveBeenCalled()

    const error = new Error('Main window cannot initialize')
    fail('MainWindowService', error)
    expect(captureExceptionMock).toHaveBeenCalledExactlyOnceWith(error, {
      level: 'fatal',
      tags: { 'failure.kind': 'startup', service: 'MainWindowService' }
    })
  })

  it('still respects consent for explicit fatal failures', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    fail('MainWindowService', new Error('Main window cannot initialize'))
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('does not mistake a post-startup hook failure for an inability to start', () => {
    lifecycle.emit(LifecycleEvents.SERVICE_ERROR, {
      name: 'MainWindowService',
      error: new Error('Deferred work failed'),
      state: LifecycleState.Ready
    })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('removes the listener on stop and does not duplicate uploads after restart', async () => {
    await service._doStop()
    fail('MainWindowService', new Error('While stopped'))
    expect(captureExceptionMock).not.toHaveBeenCalled()

    await service._doInit()
    const error = new Error('After restart')
    fail('MainWindowService', error)
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    expect(captureExceptionMock.mock.calls[0][0]).toBe(error)
  })
})

async function failRequest(error: unknown) {
  handlerMock.mockRejectedValueOnce(error)
  return application
    .get('DataApiService')
    .getApiServer()
    .handleRequest({
      id: 'failed-request',
      path: '/providers',
      method: 'GET',
      metadata: { timestamp: Date.now() }
    })
}

describe('handled DataApi failure reporting', () => {
  it.each([
    new TypeError('Broken internal state'),
    new Error('Query failed', {
      cause: Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' })
    })
  ])('reports the original internal error once while returning a serialized failure: %s', async (error) => {
    const response = await failRequest(error)

    expect(response).toMatchObject({ status: 500, error: { code: ErrorCode.INTERNAL_SERVER_ERROR } })
    expect(captureExceptionMock).toHaveBeenCalledExactlyOnceWith(error, { tags: { 'failure.kind': 'unexpected' } })
    expect(captureExceptionMock.mock.calls[0][0]).toBe(error)
    expect(flushMock).not.toHaveBeenCalled()
  })

  it('reports broken data invariants even though they use a 409 response', async () => {
    const error = DataApiErrorFactory.dataInconsistent('KnowledgeItem', 'Created item missing')
    expect(await failRequest(error)).toMatchObject({ status: 409, error: { code: ErrorCode.DATA_INCONSISTENT } })
    expect(captureExceptionMock).toHaveBeenCalledExactlyOnceWith(error, { tags: { 'failure.kind': 'unexpected' } })
  })

  it.each([
    DataApiErrorFactory.notFound('Session', 'missing'),
    DataApiErrorFactory.validation({ name: ['Required'] }),
    DataApiErrorFactory.conflict('Duplicate name'),
    DataApiErrorFactory.timeout('request', 1000)
  ])('keeps expected request failures local: %s', async (error) => {
    expect(await failRequest(error)).toMatchObject({ status: error.status, error: { code: error.code } })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('keeps internal failures local without reporting consent', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    expect(await failRequest(new TypeError('Broken internal state'))).toMatchObject({ status: 500 })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('removes the DataApi listener on stop and restores one listener on restart', async () => {
    await service._doStop()
    await failRequest(new Error('While stopped'))
    expect(captureExceptionMock).not.toHaveBeenCalled()

    await service._doInit()
    const error = new Error('After restart')
    await failRequest(error)
    expect(captureExceptionMock).toHaveBeenCalledExactlyOnceWith(error, { tags: { 'failure.kind': 'unexpected' } })
  })
})
