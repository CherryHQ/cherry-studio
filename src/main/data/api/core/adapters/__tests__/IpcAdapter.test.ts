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
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiServer } from '../../ApiServer'
import { IpcAdapter } from '../IpcAdapter'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

type IpcHandler = (event: any, payload: any) => Promise<any>

// The unified application mock resolves getPath('app.root') to '/mock/app.root'.
const trustedEvent = {
  sender: { getType: () => 'window' },
  senderFrame: { url: 'file:///mock/app.root/index.html', parent: null }
} as any
const untrustedEvents = {
  webview: {
    sender: { getType: () => 'webview' },
    senderFrame: { url: 'file:///mock/app.root/index.html', parent: null }
  },
  'sub-frame': {
    sender: { getType: () => 'window' },
    senderFrame: { url: 'file:///mock/app.root/index.html', parent: {} }
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
  let handleRequest: ReturnType<typeof vi.fn>
  let requestHandler: IpcHandler
  let subscribeHandler: IpcHandler
  let unsubscribeHandler: IpcHandler

  beforeEach(() => {
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
    subscribeHandler = handlerFor(IpcChannel.DataApi_Subscribe)
    unsubscribeHandler = handlerFor(IpcChannel.DataApi_Unsubscribe)
  })

  it('passes a trusted request through to ApiServer', async () => {
    const request = { id: 'req-1', method: 'GET', path: '/topics' }
    const response = await requestHandler(trustedEvent, request)

    expect(handleRequest).toHaveBeenCalledWith(request)
    expect(response).toMatchObject({ id: 'req-1', status: 200, data: { ok: true } })
  })

  it('rejects untrusted request senders with 403 before ApiServer is reached', async () => {
    for (const [kind, event] of Object.entries(untrustedEvents)) {
      const response = await requestHandler(event, { id: 'req-x', method: 'POST', path: '/topics' })

      expect(response.status, `${kind} sender must get 403`).toBe(403)
      expect(response.id).toBe('req-x')
      expect(response.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    }
    expect(handleRequest).not.toHaveBeenCalled()
  })

  it('allows a trusted sender to subscribe and unsubscribe', async () => {
    await expect(subscribeHandler(trustedEvent, '/topics')).resolves.toMatchObject({ success: true })
    await expect(unsubscribeHandler(trustedEvent, 'sub-1')).resolves.toMatchObject({ success: true })
  })

  it('rejects untrusted subscribe/unsubscribe senders', async () => {
    for (const event of Object.values(untrustedEvents)) {
      await expect(subscribeHandler(event, '/topics')).rejects.toThrow('untrusted sender')
      await expect(unsubscribeHandler(event, 'sub-1')).rejects.toThrow('untrusted sender')
    }
  })

  describe('BACKUP_IN_PROGRESS gate', () => {
    afterEach(async () => {
      const { setBackupInProgress } = await import('@main/data/db/backup/quiesceGate')
      setBackupInProgress(false)
    })

    it('rejects non-GET mutations while restore quiesce is held', async () => {
      const { setBackupInProgress } = await import('@main/data/db/backup/quiesceGate')
      setBackupInProgress(true)

      const response = await requestHandler(trustedEvent, {
        id: 'req-mut',
        method: 'POST',
        path: '/topics'
      })

      expect(response.status).toBe(423)
      expect(response.error).toMatchObject({ code: 'BACKUP_IN_PROGRESS', status: 423 })
      expect(handleRequest).not.toHaveBeenCalled()
    })

    it('allows GET reads while restore quiesce is held', async () => {
      const { setBackupInProgress } = await import('@main/data/db/backup/quiesceGate')
      setBackupInProgress(true)

      const request = { id: 'req-get', method: 'GET', path: '/topics' }
      const response = await requestHandler(trustedEvent, request)

      expect(handleRequest).toHaveBeenCalledWith(request)
      expect(response).toMatchObject({ id: 'req-get', status: 200, data: { ok: true } })
    })
  })
})
