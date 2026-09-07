import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MediaKind } from '../types'

const { handleMock, unhandleMock, ipcMainMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  unhandleMock: vi.fn(),
  // BaseService does `import { ipcMain } from 'electron'`; a file-level electron
  // mock replaces the global one wholesale, so its members must be re-declared.
  ipcMainMock: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() }
}))

vi.mock('electron', () => ({
  protocol: { handle: handleMock, unhandle: unhandleMock },
  ipcMain: ipcMainMock
}))

import { MediaProtocolService } from '../MediaProtocolService'

describe('MediaProtocolService', () => {
  let service: MediaProtocolService
  /** The handler the service registered — captured instead of exposing a test-only method. */
  let handler: (request: Request) => Response | Promise<Response>

  beforeEach(async () => {
    handleMock.mockReset()
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
})
