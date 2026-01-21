import { describe, expect, it, vi } from 'vitest'

vi.mock('os', () => ({
  default: {
    release: vi.fn(() => '10.0.0'),
    homedir: vi.fn(() => '/home/test')
  },
  release: vi.fn(() => '10.0.0'),
  homedir: vi.fn(() => '/home/test')
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn()
  },
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn()
}))

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
    isDestroyed: vi.fn(() => false),
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    executeJavaScript: vi.fn(async () => null),
    setWindowOpenHandler: vi.fn()
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
    public addBrowserView = vi.fn()
    public removeBrowserView = vi.fn()
    public getContentSize = vi.fn(() => [1200, 800])
    public show = vi.fn()

    constructor() {
      windows.push(this)
    }
  }

  class MockBrowserView {
    public webContents = createWebContents()
    public setBounds = vi.fn()
    public setAutoResize = vi.fn()
    public destroy = vi.fn()

    constructor() {
      views.push(this)
    }
  }

  const app = {
    isReady: vi.fn(() => true),
    whenReady: vi.fn(async () => {}),
    on: vi.fn(),
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/mock/userData'
      if (key === 'temp') return '/tmp'
      return '/mock/unknown'
    }),
    getAppPath: vi.fn(() => '/mock/app'),
    setPath: vi.fn(),
    getVersion: vi.fn(() => '1.0.0')
  }

  const nativeTheme = {
    on: vi.fn(),
    shouldUseDarkColors: false
  }

  return {
    BrowserWindow: MockBrowserWindow as any,
    BrowserView: MockBrowserView as any,
    app,
    nativeTheme,
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

  it('fetches URL and returns html format with tabId', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/', 'html')
    expect(result.tabId).toBeDefined()
    expect(result.content).toBe('<html><body><h1>Test</h1><p>Content</p></body></html>')
  })

  it('fetches URL and returns txt format with tabId', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/', 'txt')
    expect(result.tabId).toBeDefined()
    expect(result.content).toBe('Test\nContent')
  })

  it('fetches URL and returns markdown format (default) with tabId', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/')
    expect(result.tabId).toBeDefined()
    expect(typeof result.content).toBe('string')
    expect(result.content).toContain('Test')
  })

  it('fetches URL in private mode with tabId', async () => {
    const controller = new CdpBrowserController()
    const result = await controller.fetch('https://example.com/', 'html', 10000, true)
    expect(result.tabId).toBeDefined()
    expect(result.content).toBe('<html><body><h1>Test</h1><p>Content</p></body></html>')
  })

  describe('Multi-tab support', () => {
    it('creates new tab with newTab parameter', async () => {
      const controller = new CdpBrowserController()
      const result1 = await controller.open('https://site1.com/', 5000, false, true)
      const result2 = await controller.open('https://site2.com/', 5000, false, true)

      expect(result1.tabId).toBeDefined()
      expect(result2.tabId).toBeDefined()
      expect(result1.tabId).not.toBe(result2.tabId)
    })

    it('reuses same tab without newTab parameter', async () => {
      const controller = new CdpBrowserController()
      const result1 = await controller.open('https://site1.com/', 5000, false)
      const result2 = await controller.open('https://site2.com/', 5000, false)

      expect(result1.tabId).toBe(result2.tabId)
    })

    it('fetches in new tab with newTab parameter', async () => {
      const controller = new CdpBrowserController()
      await controller.open('https://example.com/', 5000, false)
      const tabs = await controller.listTabs(false)
      const initialTabCount = tabs.length

      await controller.fetch('https://other.com/', 'html', 10000, false, true)
      const tabsAfter = await controller.listTabs(false)

      expect(tabsAfter.length).toBe(initialTabCount + 1)
    })
  })

  describe('Tab management', () => {
    it('lists tabs in a window', async () => {
      const controller = new CdpBrowserController()
      await controller.open('https://example.com/', 5000, false)

      const tabs = await controller.listTabs(false)
      expect(tabs.length).toBeGreaterThan(0)
      expect(tabs[0].tabId).toBeDefined()
    })

    it('lists tabs separately for normal and private modes', async () => {
      const controller = new CdpBrowserController()
      await controller.open('https://example.com/', 5000, false)
      await controller.open('https://example.com/', 5000, true)

      const normalTabs = await controller.listTabs(false)
      const privateTabs = await controller.listTabs(true)

      expect(normalTabs.length).toBe(1)
      expect(privateTabs.length).toBe(1)
      expect(normalTabs[0].tabId).not.toBe(privateTabs[0].tabId)
    })

    it('closes specific tab', async () => {
      const controller = new CdpBrowserController()
      const result1 = await controller.open('https://site1.com/', 5000, false, true)
      await controller.open('https://site2.com/', 5000, false, true)

      const tabsBefore = await controller.listTabs(false)
      expect(tabsBefore.length).toBe(2)

      await controller.closeTab(false, result1.tabId)

      const tabsAfter = await controller.listTabs(false)
      expect(tabsAfter.length).toBe(1)
      expect(tabsAfter.find((t) => t.tabId === result1.tabId)).toBeUndefined()
    })

    it('switches active tab', async () => {
      const controller = new CdpBrowserController()
      const result1 = await controller.open('https://site1.com/', 5000, false, true)
      const result2 = await controller.open('https://site2.com/', 5000, false, true)

      await controller.switchTab(false, result1.tabId)
      await controller.switchTab(false, result2.tabId)
    })

    it('throws error when switching to non-existent tab', async () => {
      const controller = new CdpBrowserController()
      await controller.open('https://example.com/', 5000, false)

      await expect(controller.switchTab(false, 'non-existent-tab')).rejects.toThrow('Tab non-existent-tab not found')
    })
  })

  describe('Reset behavior', () => {
    it('resets specific tab only', async () => {
      const controller = new CdpBrowserController()
      const result1 = await controller.open('https://site1.com/', 5000, false, true)
      await controller.open('https://site2.com/', 5000, false, true)

      await controller.reset(false, result1.tabId)

      const tabs = await controller.listTabs(false)
      expect(tabs.length).toBe(1)
    })

    it('resets specific window only', async () => {
      const controller = new CdpBrowserController()
      await controller.open('https://example.com/', 5000, false)
      await controller.open('https://example.com/', 5000, true)

      await controller.reset(false)

      const normalTabs = await controller.listTabs(false)
      const privateTabs = await controller.listTabs(true)

      expect(normalTabs.length).toBe(0)
      expect(privateTabs.length).toBe(1)
    })

    it('resets all windows', async () => {
      const controller = new CdpBrowserController()
      await controller.open('https://example.com/', 5000, false)
      await controller.open('https://example.com/', 5000, true)

      await controller.reset()

      const normalTabs = await controller.listTabs(false)
      const privateTabs = await controller.listTabs(true)

      expect(normalTabs.length).toBe(0)
      expect(privateTabs.length).toBe(0)
    })
  })

  describe('showWindow parameter', () => {
    it('passes showWindow parameter through open', async () => {
      const controller = new CdpBrowserController()
      const result = await controller.open('https://example.com/', 5000, false, false, true)
      expect(result.currentUrl).toBe('https://example.com/')
      expect(result.tabId).toBeDefined()
    })

    it('passes showWindow parameter through fetch', async () => {
      const controller = new CdpBrowserController()
      const result = await controller.fetch('https://example.com/', 'html', 10000, false, false, true)
      expect(result.tabId).toBeDefined()
      expect(result.content).toBe('<html><body><h1>Test</h1><p>Content</p></body></html>')
    })

    it('passes showWindow parameter through createTab', async () => {
      const controller = new CdpBrowserController()
      const { tabId, view } = await controller.createTab(false, true)
      expect(tabId).toBeDefined()
      expect(view).toBeDefined()
    })

    it('shows existing window when showWindow=true on subsequent calls', async () => {
      const controller = new CdpBrowserController()
      // First call creates window
      await controller.open('https://example.com/', 5000, false, false, false)
      // Second call with showWindow=true should show existing window
      const result = await controller.open('https://example.com/', 5000, false, false, true)
      expect(result.currentUrl).toBe('https://example.com/')
    })
  })

  describe('Window limits and eviction', () => {
    it('respects maxWindows limit', async () => {
      const controller = new CdpBrowserController({ maxWindows: 1 })
      await controller.open('https://example.com/', 5000, false)
      await controller.open('https://example.com/', 5000, true)

      const normalTabs = await controller.listTabs(false)
      const privateTabs = await controller.listTabs(true)

      expect(privateTabs.length).toBe(1)
      expect(normalTabs.length).toBe(0)
    })

    it('cleans up idle windows on next access', async () => {
      const controller = new CdpBrowserController({ idleTimeoutMs: 1 })
      await controller.open('https://example.com/', 5000, false)

      await new Promise((r) => setTimeout(r, 10))

      await controller.open('https://example.com/', 5000, true)

      const normalTabs = await controller.listTabs(false)
      expect(normalTabs.length).toBe(0)
    })
  })
})
