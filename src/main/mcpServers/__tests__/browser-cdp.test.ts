import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const sendCommand = vi.fn(async (command: string) => {
    if (command === 'Runtime.evaluate') {
      return { result: { value: 'ok' } }
    }
    return {}
  })

  const debuggerObj = {
    isAttached: vi.fn(() => true),
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand
  }

  const webContents = {
    debugger: debuggerObj,
    setUserAgent: vi.fn(),
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(async () => 'Example Title'),
    once: vi.fn(),
    removeListener: vi.fn(),
    on: vi.fn()
  }

  const loadURL = vi.fn(async () => {})

  const windows: any[] = []

  class MockBrowserWindow {
    private destroyed = false
    public webContents = webContents
    public loadURL = loadURL
    public isDestroyed = vi.fn(() => this.destroyed)
    public close = vi.fn(() => {
      this.destroyed = true
    })
    public destroy = vi.fn(() => {
      this.destroyed = true
    })
    public on = vi.fn()

    constructor() {
      windows.push(this)
    }
  }

  const app = {
    isReady: vi.fn(() => true),
    whenReady: vi.fn(async () => {}),
    on: vi.fn()
  }

  return {
    BrowserWindow: MockBrowserWindow as any,
    app,
    __mockDebugger: debuggerObj,
    __mockSendCommand: sendCommand,
    __mockLoadURL: loadURL,
    __mockWindows: windows
  }
})

import { __mockWindows } from 'electron'
import { CdpBrowserController } from '../browser-cdp'

describe('CdpBrowserController', () => {
  it('executes single-line code via Runtime.evaluate', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.execute('1+1')
    expect(result).toBe('ok')
  })

  it('opens a URL (hidden) and returns current page info', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.open('https://foo.bar/', 5000, false)
    expect(result.currentUrl).toBe('https://example.com/')
    expect(result.title).toBe('Example Title')
  })

  it('opens a URL (visible) when show=true', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.open('https://foo.bar/', 5000, true, 'session-a')
    expect(result.currentUrl).toBe('https://example.com/')
    expect(result.title).toBe('Example Title')
  })

  it('reuses session for execute and supports multiline', async () => {
    const controller = new CdpBrowserController()
    await controller.open('https://foo.bar/', 5000, false, 'session-b')
    const result = await controller.execute('const a=1; const b=2; a+b;', 5000, 'session-b')
    expect(result).toBe('ok')
  })

  it('evicts least recently used session when exceeding maxSessions', async () => {
    const controller = new CdpBrowserController({ maxSessions: 2, idleTimeoutMs: 1000 * 60 })
    await controller.open('https://foo.bar/', 5000, false, 's1')
    await controller.open('https://foo.bar/', 5000, false, 's2')
    await controller.open('https://foo.bar/', 5000, false, 's3')
    const destroyedCount = __mockWindows.filter((w: any) => w.destroy.mock.calls.length > 0 || w.close.mock.calls.length > 0).length
    expect(destroyedCount).toBeGreaterThanOrEqual(1)
  })
})
