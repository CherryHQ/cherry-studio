/**
 * IpcAdapter source-trust gate tests.
 *
 * The adapter bridges Electron IPC to ApiServer. Requests must reject senders
 * that are not the app's own top-level renderer frame before they reach
 * ApiServer, while committed change batches fan out through WindowManager.
 */
import { application } from '@application'
import type { DataApiChangeBatch, DataApiChangeEnvelope } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  let adapter: IpcAdapter
  let handleRequest: ReturnType<typeof vi.fn>
  let requestHandler: IpcHandler
  let broadcast: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear()
    vi.mocked(ipcMain.removeHandler).mockClear()
    broadcast = application.get('WindowManager').broadcast as ReturnType<typeof vi.fn>
    broadcast.mockClear()
    handleRequest = vi.fn(async (request) => ({
      id: request.id,
      status: 200,
      data: { ok: true },
      metadata: { duration: 1, timestamp: 1 }
    }))
    adapter = new IpcAdapter({ handleRequest } as unknown as ApiServer)
    adapter.setup()

    const calls = vi.mocked(ipcMain.handle).mock.calls
    const handlerFor = (channel: string) => calls.find((call) => call[0] === channel)![1] as IpcHandler
    requestHandler = handlerFor(IpcChannel.DataApi_Request)
  })

  it('registers only the DataApi request handler', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([channel]) => channel)).toEqual([IpcChannel.DataApi_Request])
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

  it('broadcasts a committed change batch to every managed window', () => {
    type TestChange = DataApiChangeEnvelope<'test.projection', { id: string }>
    const wireBatch = {
      changes: [{ type: 'test.projection', payload: { id: 'item-1' } }]
    } satisfies { changes: TestChange[] }
    const batch = wireBatch as unknown as DataApiChangeBatch

    adapter.publishChanges(batch)

    expect(broadcast).toHaveBeenCalledWith(IpcChannel.DataApi_Changed, batch)
  })

  it('removes only the DataApi request handler once on dispose', () => {
    adapter.dispose()
    adapter.dispose()

    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(1)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IpcChannel.DataApi_Request)
  })
})
