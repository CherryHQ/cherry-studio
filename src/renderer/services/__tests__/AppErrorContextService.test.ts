import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { createAppErrorContext, summarizeErrorParams } from '@shared/utils/appError'
import { doctorScopeKey } from '@shared/utils/doctor'

import type * as ContextModule from '../AppErrorContextService'
let contextFromUnknown: typeof ContextModule.contextFromUnknown
let detailErrorFromHost: typeof ContextModule.detailErrorFromHost
let diagnosticErrorFromUnknown: typeof ContextModule.diagnosticErrorFromUnknown
let operationSubject: typeof ContextModule.operationSubject
let appErrorContextService: typeof ContextModule.appErrorContextService

import type * as RouteModule from '../PresentedRouteService'
let presentedRouteService: typeof RouteModule.presentedRouteService

describe('app error presentation', () => {
  beforeEach(async () => {
    vi.resetModules()
    ;({
      contextFromUnknown,
      detailErrorFromHost,
      diagnosticErrorFromUnknown,
      operationSubject,
      appErrorContextService
    } = await import('../AppErrorContextService'))
    ;({ presentedRouteService } = await import('../PresentedRouteService'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps message and stack from a plain serialized object and drops prompt params', () => {
    const context = contextFromUnknown(
      { details: 'ignored when message exists', message: 'upstream boom', name: 'APICallError', stack: 'at call.ts:2' },
      {
        operation: 'painting.generate',
        params: summarizeErrorParams({ prompt: 'draw a cat', seed: 7 }, ['seed', 'prompt']),
        source: 'painting'
      }
    )

    expect(context).toMatchObject({
      message: 'upstream boom',
      name: 'APICallError',
      operation: 'painting.generate',
      params: { seed: 7 },
      source: 'painting',
      stack: 'at call.ts:2'
    })
    expect(context.stack).not.toContain('Error:')
    expect(JSON.stringify(context)).not.toContain('draw a cat')
  })

  it('gives a reused notification key a new occurrence while the open snapshot stays unchanged', () => {
    const firstCause = new Error('first')
    const first = appErrorContextService.contextForHostError('occurrence-1', {
      cause: firstCause,
      title: 'First failure'
    })
    const second = appErrorContextService.contextForHostError('occurrence-2', {
      cause: new Error('second'),
      title: 'Second failure'
    })

    expect(second.id).not.toBe(first.id)
    expect(
      appErrorContextService.contextForHostError('occurrence-1', { cause: new Error('replacement'), title: 'Changed' })
    ).toBe(first)
    expect(first.message).toBe('first')
  })

  it('collapses only a short repeat of the same uncaught object', () => {
    const error = new Error('boom')
    expect(appErrorContextService.rememberUncaught(error, 1_000)).toBe(true)
    expect(appErrorContextService.rememberUncaught(error, 1_500)).toBe(false)
    expect(appErrorContextService.rememberUncaught(new Error('boom'), 1_500)).toBe(true)
    expect(appErrorContextService.rememberUncaught(error, 4_000)).toBe(true)
  })

  it('keeps provider status and response body from the original IPC failure', () => {
    const detail = {
      message: 'quota',
      name: 'AI_APICallError',
      responseBody: '{"error":"quota"}',
      stack: 'at provider.ts:9',
      statusCode: 429
    }
    const cause = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, 'Generation failed', detail)

    expect(diagnosticErrorFromUnknown(cause)).toMatchObject({
      responseBody: '{"error":"quota"}',
      statusCode: 429
    })
    expect(detailErrorFromHost(cause, undefined)).toMatchObject({ statusCode: 429, responseBody: '{"error":"quota"}' })
    expect(JSON.stringify(diagnosticErrorFromUnknown(cause))).not.toContain('draw a cat')
  })

  it('puts the original status and response on the snapshot, not the localized title', () => {
    const cause = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, 'Generation failed', {
      message: 'quota exceeded',
      name: 'AI_APICallError',
      responseBody: JSON.stringify({
        error: 'quota',
        prompt: 'draw a cat',
        requestBodyValues: { messages: ['private question'] }
      }),
      stack: 'at provider.ts:9',
      statusCode: 429
    })

    const context = appErrorContextService.contextForHostError('occurrence-9', {
      cause,
      title: 'Image generation failed'
    })

    expect(context.id).not.toBe('occurrence-9')
    expect(context.message).toBe('quota exceeded')
    expect(context.statusCode).toBe(429)
    expect(context.responseBody).toContain('quota')
    expect(JSON.stringify(context)).not.toContain('draw a cat')
    expect(JSON.stringify(context)).not.toContain('private question')
    expect(JSON.stringify(context)).not.toContain('Image generation failed')
  })

  it('freezes identity and origin at presentation and does not share a scope across windows', async () => {
    document.querySelector('meta[name="logger-window-source"]')?.remove()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    presentedRouteService.recordPresentedRoute('/paintings')
    const main = appErrorContextService.contextForHostError('1', { cause: new Error('main fault'), title: 'Failed' })

    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))
    presentedRouteService.recordPresentedRoute('/settings/provider')
    expect(appErrorContextService.contextForHostError('1', { cause: new Error('later'), title: 'Changed' })).toBe(main)
    expect(main.occurredAt).toBe('2026-03-01T00:00:00.000Z')
    expect(main.message).toBe('main fault')
    expect(main.source).toBe('/paintings')
    expect(main.id).not.toBe('1')

    const explicit = createAppErrorContext({
      id: 'fixed-id',
      occurredAt: '2026-01-01T00:00:00.000Z',
      message: 'kept',
      operation: 'painting.generate',
      source: 'painting'
    })
    expect(
      appErrorContextService.contextForHostError('explicit', { data: { errorContext: explicit }, title: 'other' })
    ).toBe(explicit)

    // A second window evaluates its own copy of these modules.
    vi.resetModules()
    const subWindow = await import('../AppErrorContextService')
    const subRoute = await import('../PresentedRouteService')
    subRoute.presentedRouteService.recordPresentedRoute('/paintings')
    const sub = subWindow.appErrorContextService.contextForHostError('1', {
      cause: new Error('sub fault'),
      title: 'Failed'
    })
    expect(sub.id).not.toBe('1')
    expect(sub.id).not.toBe(main.id)
    expect(doctorScopeKey(operationSubject(main))).not.toBe(doctorScopeKey(operationSubject(sub)))
  })
})
