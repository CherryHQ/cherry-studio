import { EventEmitter } from 'node:events'

import { vi } from 'vitest'

export function createGuest(id = 1) {
  let attached = false
  let destroyed = false
  const debuggerEvents = new EventEmitter()
  const debuggerSession = Object.assign(debuggerEvents, {
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
      debuggerEvents.emit('detach', {}, 'target_closed')
    }),
    isAttached: vi.fn(() => attached),
    sendCommand: vi.fn<(method: string, params?: object) => Promise<any>>(async (method) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'document-1' } } }
      return {}
    })
  })
  const events = new EventEmitter()
  const mock = Object.assign(events, {
    id,
    debugger: debuggerSession,
    isDestroyed: vi.fn(() => destroyed),
    isDevToolsOpened: vi.fn(() => false),
    getTitle: vi.fn(() => 'Test page'),
    getURL: vi.fn(() => 'https://example.com'),
    close: vi.fn(() => {
      destroyed = true
      events.emit('destroyed')
    })
  })
  return { mock, guest: mock as unknown as Electron.WebContents }
}
