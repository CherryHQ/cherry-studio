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
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(async () => 'Example Title')
  }

  const loadURL = vi.fn(async () => {})

  class MockBrowserWindow {
    public webContents = webContents
    public loadURL = loadURL
    public isDestroyed = vi.fn(() => false)
    public close = vi.fn()
    public on = vi.fn()
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
    __mockLoadURL: loadURL
  }
})

import { CdpBrowserController } from '../browser-cdp'

describe('CdpBrowserController', () => {
  it('rejects multiline code', async () => {
    const controller = new CdpBrowserController()
    await expect(controller.execute('line1\nline2')).rejects.toThrow(/single line/i)
  })

  it('executes single-line code via Runtime.evaluate', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.execute('1+1')
    expect(result).toBe('ok')
  })

  it('opens a URL and returns current page info', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.open('https://foo.bar/', 5000)
    expect(result.currentUrl).toBe('https://example.com/')
    expect(result.title).toBe('Example Title')
  })
})
