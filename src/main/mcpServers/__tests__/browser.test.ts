import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const sendCommand = vi.fn(async (command: string, params?: { expression?: string }) => {
    if (command === 'Runtime.evaluate') {
      if (params?.expression === 'document.documentElement.outerHTML') {
        return { result: { value: '<html><body><h1>Test</h1><p>Content</p></body></html>' } }
      }
      if (params?.expression === 'document.body.innerText') {
        return { result: { value: 'Test\nContent' } }
      }
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

  const createWebContents = () => ({
    debugger: debuggerObj,
    setUserAgent: vi.fn(),
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(async () => 'Example Title'),
    loadURL: vi.fn(async () => {}),
    once: vi.fn(),
    removeListener: vi.fn(),
    on: vi.fn(),
    isDestroyed: vi.fn(() => false)
  })

  const windows: any[] = []
  const views: any[] = []

  class MockBrowserWindow {
    private destroyed = false
    public webContents = createWebContents()
    public isDestroyed = vi.fn(() => this.destroyed)
    public close = vi.fn(() => {
      this.destroyed = true
    })
    public destroy = vi.fn(() => {
      this.destroyed = true
    })
    public on = vi.fn()
    public setBrowserView = vi.fn()
    public removeBrowserView = vi.fn()
    public getContentSize = vi.fn(() => [1200, 800])

    constructor() {
      windows.push(this)
    }
  }

  class MockBrowserView {
    public webContents = createWebContents()
    public setBounds = vi.fn()
    public destroy = vi.fn()

    constructor() {
      views.push(this)
    }
  }

  const app = {
    isReady: vi.fn(() => true),
    whenReady: vi.fn(async () => {}),
    on: vi.fn()
  }

  return {
    BrowserWindow: MockBrowserWindow as any,
    BrowserView: MockBrowserView as any,
    app,
    __mockDebugger: debuggerObj,
    __mockSendCommand: sendCommand,
    __mockWindows: windows,
    __mockViews: views
  }
})

import { CdpBrowserController } from '../browser'

describe('CdpBrowserController', () => {
  it('executes single-line code via Runtime.evaluate', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.execute('1+1')
    expect(result).toBe('ok')
  })

  it('opens a URL in normal mode and returns current page info', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.open('https://foo.bar/', 5000, false)
    expect(result.currentUrl).toBe('https://example.com/')
    expect(result.title).toBe('Example Title')
  })

  it('opens a URL in private mode', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.open('https://foo.bar/', 5000, true)
    expect(result.currentUrl).toBe('https://example.com/')
    expect(result.title).toBe('Example Title')
  })

  it('reuses session for execute and supports multiline', async () => {
    const controller = new CdpBrowserController()
    await controller.open('https://foo.bar/', 5000, false)
    const result = await controller.execute('const a=1; const b=2; a+b;', 5000, false)
    expect(result).toBe('ok')
  })

  it('normal and private modes are isolated', async () => {
    const controller = new CdpBrowserController()
    await controller.open('https://foo.bar/', 5000, false)
    await controller.open('https://foo.bar/', 5000, true)
    const normalResult = await controller.execute('1+1', 5000, false)
    const privateResult = await controller.execute('1+1', 5000, true)
    expect(normalResult).toBe('ok')
    expect(privateResult).toBe('ok')
  })

  it('fetches URL and returns html format', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/', 'html')
    expect(result).toBe('<html><body><h1>Test</h1><p>Content</p></body></html>')
  })

  it('fetches URL and returns txt format', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/', 'txt')
    expect(result).toBe('Test\nContent')
  })

  it('fetches URL and returns markdown format (default)', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/')
    expect(typeof result).toBe('string')
    expect(result).toContain('Test')
  })

  it('fetches URL in private mode', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/', 'html', 10000, true)
    expect(result).toBe('<html><body><h1>Test</h1><p>Content</p></body></html>')
  })
})
