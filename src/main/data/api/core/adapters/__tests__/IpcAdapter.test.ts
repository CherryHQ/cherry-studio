import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
/**
 * IpcAdapter source-trust gate tests.
 *
 * The adapter bridges Electron IPC to ApiServer; every channel must reject
 * senders that are not the app's own top-level renderer frame BEFORE the
 * request reaches ApiServer (see core/security/validateSender). The pure URL logic is
 * covered in core/security/__tests__/validateSender.test.ts — here we verify the
 * wiring: rejection short-circuits, trusted requests pass through.
 */
import { IpcChannel } from '@shared/IpcChannel'

import type { ApiServer } from '../../ApiServer'
import { IpcAdapter } from '../IpcAdapter'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

type IpcHandler = (event: any, payload: any) => Promise<any>

// The unified application mock resolves getPath('app.root') to '/mock/app.root'.
const trustedUrl = pathToFileURL(join(application.getPath('app.root'), 'index.html')).toString()
const trustedEvent = {
  sender: { id: 7, getType: () => 'window' },
  senderFrame: { url: trustedUrl, parent: null }
} as any
const untrustedEvents = {
  webview: {
    sender: { getType: () => 'webview' },
    senderFrame: { url: trustedUrl, parent: null }
  },
  'sub-frame': {
    sender: { getType: () => 'window' },
    senderFrame: { url: trustedUrl, parent: {} }
  },
  'remote origin': {
    sender: { getType: () => 'window' },
    senderFrame: { url: 'https://evil.example.com/', parent: null }
  },
  'missing frame': {
    sender: { getType: () => 'window' },
    senderFrame: null
  }
} as Record<string, any>

describe('IpcAdapter', () => {
  let handleRequest: ReturnType<typeof vi.fn<(...args: any[]) => any>>
  let requestHandler: IpcHandler

  beforeEach(() => {
    MockApplicationUtils.resetServices()
    vi.mocked(ipcMain.handle).mockClear()
    handleRequest = vi.fn(async (request) => ({
      id: request.id,
      status: 200,
      data: { ok: true },
      metadata: { duration: 1, timestamp: 1 }
    }))
    new IpcAdapter({ handleRequest } as unknown as ApiServer).setup()

    const calls = vi.mocked(ipcMain.handle).mock.calls
    const handlerFor = (channel: string) => calls.find((call) => call[0] === channel)![1] as IpcHandler
    requestHandler = handlerFor(IpcChannel.DataApi_Request)
  })

  it('passes a trusted request through to ApiServer', async () => {
    const request = { id: 'req-1', method: 'GET', path: '/topics' }
    const response = await requestHandler(trustedEvent, request)

    expect(handleRequest).toHaveBeenCalledWith(request, {
      requestId: null,
      operationId: null,
      retryAttempt: null,
      source: 'unknown',
      actor: { kind: 'unknown' }
    })
    expect(response).toMatchObject({ id: 'req-1', status: 200, data: { ok: true } })
  })

  it('uses the verified sender for identity and sanitizes only diagnostic metadata', async () => {
    MockApplicationUtils.setService('WindowManager', {
      getWindowIdByWebContents: (sender: unknown) => (sender === trustedEvent.sender ? 'main-1' : undefined)
    })
    const operationId = '24065000-0000-4000-8000-000000000001'
    const request = {
      id: 'req-2',
      method: 'PATCH',
      path: '/assistants/A',
      metadata: {
        source: 'assistant-edit.save',
        operationId,
        retryAttempt: 1,
        actor: { kind: 'main', source: 'forged' }
      }
    }
    const response = await requestHandler(trustedEvent, request)
    expect(response).toMatchObject({ status: 200, data: { ok: true } })
    expect(handleRequest.mock.calls[0][1]).toEqual({
      requestId: null,
      operationId,
      retryAttempt: 1,
      source: 'assistant-edit.save',
      actor: { kind: 'renderer', webContentsId: 7, windowId: 'main-1' }
    })
  })

  it.each([
    { source: '', operationId: 'invalid' },
    { source: 'Bad Source', operationId: 123 },
    { source: 'x'.repeat(129), operationId: null },
    { source: 'sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa', operationId: 'req_1700000000000_7' },
    { source: 42 },
    {}
  ])('accepts requests with invalid or absent diagnostics: %j', async (metadata) => {
    const response = await requestHandler(trustedEvent, {
      id: 'req-3',
      method: 'PATCH',
      path: '/assistants/A',
      metadata
    })
    expect(response).toMatchObject({ status: 200, data: { ok: true } })
    expect(handleRequest.mock.calls[0][1]).toEqual({
      requestId: null,
      operationId: null,
      retryAttempt: null,
      source: 'unknown',
      actor: { kind: 'unknown' }
    })
  })

  it.each([
    ['arbitrary caller string', null],
    ['req_1700000000000_7', 'req_1700000000000_7'],
    ['req_1700000000000_123456789', 'req_1700000000000_123456789'],
    ['req_x_1', null],
    ['x'.repeat(200), null],
    ['req_12345678901234567_1', null],
    ['req_1_12345678901234567', null],
    ['24065000-0000-4000-8000-000000000002', '24065000-0000-4000-8000-000000000002']
  ])('sanitizes request ID %j for attribution', async (id, requestId) => {
    const request = { id, method: 'PATCH', path: '/assistants/A' }
    const response = await requestHandler(trustedEvent, request)

    expect(response).toMatchObject({ id, status: 200 })
    expect(handleRequest.mock.calls[0][0]).toEqual(request)
    expect(handleRequest.mock.calls[0][1].requestId).toBe(requestId)
  })

  it.each(['assistant-edit.save', 'composer.mcp-toggle', 'doctor.data-api'])(
    'preserves allowlisted source %s',
    async (source) => {
      await requestHandler(trustedEvent, {
        id: 'req_1700000000000_7',
        method: 'PATCH',
        path: '/assistants/A',
        metadata: { source }
      })

      expect(handleRequest.mock.calls[0][1].source).toBe(source)
    }
  )

  it.each([0, Number.MAX_SAFE_INTEGER])('preserves valid retry attempt %j', async (retryAttempt) => {
    await requestHandler(trustedEvent, {
      id: 'req-retry',
      method: 'PATCH',
      path: '/assistants/A',
      metadata: { retryAttempt }
    })

    expect(handleRequest.mock.calls[0][1].retryAttempt).toBe(retryAttempt)
  })

  it.each([-1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'discards malformed retry attempt %j',
    async (retryAttempt) => {
      await requestHandler(trustedEvent, {
        id: 'req-retry',
        method: 'PATCH',
        path: '/assistants/A',
        metadata: { retryAttempt }
      })

      expect(handleRequest.mock.calls[0][1].retryAttempt).toBeNull()
    }
  )

  it('rejects untrusted request senders with 403 before ApiServer is reached', async () => {
    for (const [kind, event] of Object.entries(untrustedEvents)) {
      const response = await requestHandler(event, { id: 'req-x', method: 'POST', path: '/topics' })

      expect(response.status, `${kind} sender must get 403`).toBe(403)
      expect(response.id).toBe('req-x')
      expect(response.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    }
    expect(handleRequest).not.toHaveBeenCalled()
  })
})
