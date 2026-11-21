import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { readToolResultImage } from '@main/ai/messages/toolResultImageResources'
import type * as ToolResultImageResources from '@main/ai/messages/toolResultImageResources'
import { BaseService } from '@main/core/lifecycle'

import { MediaKind } from '../types'

const { handleMock, unhandleMock, beforeRequestMock, ipcMainMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  unhandleMock: vi.fn(),
  beforeRequestMock: vi.fn(),
  // BaseService does `import { ipcMain } from 'electron'`; a file-level electron
  // mock replaces the global one wholesale, so its members must be re-declared.
  ipcMainMock: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() }
}))

vi.mock('electron', () => ({
  protocol: { handle: handleMock, unhandle: unhandleMock },
  session: { defaultSession: { webRequest: { onBeforeRequest: beforeRequestMock } } },
  ipcMain: ipcMainMock
}))

vi.mock('@main/ai/messages/toolResultImageResources', async (importOriginal) => ({
  ...(await importOriginal<typeof ToolResultImageResources>()),
  readToolResultImage: vi.fn()
}))

import { MediaProtocolService } from '../MediaProtocolService'

describe('MediaProtocolService', () => {
  let service: MediaProtocolService
  /** The handler the service registered — captured instead of exposing a test-only method. */
  let handler: (request: Request) => Response | Promise<Response>

  beforeEach(async () => {
    handleMock.mockReset()
    beforeRequestMock.mockReset()
    handleMock.mockImplementation((_scheme: string, fn: typeof handler) => {
      handler = fn
    })
    // BaseService enforces one instance per class; without this the second `new`
    // throws on the singleton guard.
    BaseService.resetInstances()
    service = new MediaProtocolService()
    await service._doInit()
  })

  afterEach(async () => {
    await service._doDestroy()
  })

  it('serves a stored buffer at its own url and 404s after removal', async () => {
    const id = service.store(MediaKind.Image, Buffer.from([1, 2, 3]), 'image/png')
    const url = service.getUrl(MediaKind.Image, id)
    expect(url).toBe(`cherry-media://image/${id}`)

    const hit = await handler(new Request(url))
    expect(hit.status).toBe(200)
    expect(hit.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await hit.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    expect(service.remove(MediaKind.Image, id)).toBe(true)
    expect((await handler(new Request(url))).status).toBe(404)
  })

  it('serves a latest tool image without registering or retaining another media entry', async () => {
    const uri = 'cherry-media://tool-result/topic%3A1/message%2F1/call/0'
    vi.mocked(readToolResultImage).mockResolvedValue({ data: Buffer.from([1, 2, 3]), mimeType: 'image/png' })
    const response = await handler(new Request(uri))
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
    expect(readToolResultImage).toHaveBeenCalledWith(
      { topicId: 'topic:1', messageId: 'message/1', toolCallId: 'call', imageIndex: 0 },
      0
    )
    vi.mocked(readToolResultImage).mockResolvedValue({ data: Buffer.from([9]), mimeType: 'image/png' })
    expect([...new Uint8Array(await (await handler(new Request(uri))).arrayBuffer())]).toEqual([9])
    const head = await handler(new Request(uri, { method: 'HEAD' }))
    expect(await head.text()).toBe('')
    expect(head.headers.get('Content-Length')).toBe('1')
    vi.mocked(readToolResultImage).mockResolvedValue(undefined)
    expect((await handler(new Request(uri))).status).toBe(404)
    expect((await handler(new Request('cherry-media://tool-result/topic/message/call/-1'))).status).toBe(400)
  })

  it('denies tool image reads from untrusted or missing renderer provenance', () => {
    vi.mocked(application.getPath).mockReturnValue('/app')
    const check = beforeRequestMock.mock.calls[0][1]
    const main = { url: 'file:///app/renderer/index.html', top: undefined as unknown }
    main.top = main
    const allowed = (webContentsId: number | undefined, frame: unknown) => {
      let cancelled: boolean | undefined
      check(
        { url: 'cherry-media://tool-result/topic/message/call/0', webContentsId, frame },
        (response: { cancel: boolean }) => {
          cancelled = response.cancel
        }
      )
      return cancelled === false
    }
    expect(allowed(7, main)).toBe(true)
    expect(allowed(undefined, main)).toBe(false)
    expect(allowed(7, undefined)).toBe(false)
    expect(allowed(7, { url: main.url, top: main })).toBe(false)
    main.url = 'https://untrusted.example'
    expect(allowed(7, main)).toBe(false)
  })

  it('rejects an unknown kind instead of falling through to another kind store', async () => {
    const id = service.store(MediaKind.Image, Buffer.from([9]), 'image/png')
    const response = await handler(new Request(`cherry-media://video/${id}`))
    expect(response.status).toBe(400)
  })

  it('rejects a url with no id rather than serving an arbitrary entry', async () => {
    service.store(MediaKind.Image, Buffer.from([9]), 'image/png')
    expect((await handler(new Request('cherry-media://image/'))).status).toBe(400)
  })

  it('drops every entry on destroy so a shutdown cannot leave captures resident', async () => {
    const id = service.store(MediaKind.Image, Buffer.from([5]), 'image/png')
    await service._doDestroy()
    // Asserted through the protocol rather than a store probe: serving a capture after
    // shutdown is the failure that matters, and it is what a renderer would still see.
    expect((await handler(new Request(`cherry-media://image/${id}`))).status).toBe(404)
    // afterEach's second _doDestroy() must stay harmless.
  })
  it('serves audio byte ranges and HEAD without altering the stored WAV', async () => {
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5])
    const id = service.store(MediaKind.Audio, bytes, 'audio/wav')
    const url = service.getUrl(MediaKind.Audio, id)
    for (const [range, expected, contentRange] of [
      ['bytes=1-3', [1, 2, 3], 'bytes 1-3/6'],
      ['bytes=4-', [4, 5], 'bytes 4-5/6'],
      ['bytes=-2', [4, 5], 'bytes 4-5/6']
    ] as const) {
      const response = await handler(new Request(url, { headers: { Range: range } }))
      expect(response.status).toBe(206)
      expect(response.headers.get('Content-Range')).toBe(contentRange)
      expect(response.headers.get('Content-Length')).toBe(String(expected.length))
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expected)
    }
    const head = await handler(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Length')).toBe('6')
    expect(head.headers.get('Cache-Control')).toBe('no-store')
    expect(await head.text()).toBe('')
    const unsatisfied = await handler(new Request(url, { headers: { Range: 'bytes=6-' } }))
    expect(unsatisfied.status).toBe(416)
    expect(unsatisfied.headers.get('Content-Range')).toBe('bytes */6')
    for (const range of ['nonsense', 'bytes=0-0,4-5']) {
      const response = await handler(new Request(url, { headers: { Range: range } }))
      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes))
    }
    expect((await handler(new Request(url, { method: 'POST' }))).status).toBe(405)
    service.remove(MediaKind.Audio, id)
    expect((await handler(new Request(url))).status).toBe(404)
  })

  it('restricts owned media to the trusted main frame of its issuing window', () => {
    vi.mocked(application.getPath).mockReturnValue('/app')
    const id = service.store(MediaKind.Audio, Buffer.from([1]), 'audio/wav', { webContentsId: 7 })
    const url = service.getUrl(MediaKind.Audio, id)
    const check = beforeRequestMock.mock.calls[0][1]
    const main = { url: 'file:///app/renderer/index.html', top: undefined as unknown }
    main.top = main
    function allowed(webContentsId: number | undefined, frame: unknown) {
      let cancelled: boolean | undefined
      check({ url, webContentsId, frame }, (response: { cancel: boolean }) => {
        cancelled = response.cancel
      })
      return cancelled === false
    }
    expect(allowed(7, main)).toBe(true)
    expect(allowed(8, main)).toBe(false)
    expect(allowed(undefined, main)).toBe(false)
    expect(allowed(7, undefined)).toBe(false)
    expect(allowed(7, { url: main.url, top: main })).toBe(false)
    main.url = 'https://untrusted.example'
    expect(allowed(7, main)).toBe(false)
  })
})
