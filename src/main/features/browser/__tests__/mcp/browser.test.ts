import { application } from '@application'
import { createInMemoryMcpServer } from '@main/ai/mcp/servers/factory'
import { BaseService, Signal } from '@main/core/lifecycle'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserSessionService } from '../../BrowserSessionService'
import { CdpBrowserController } from '../../mcp/controller'
import { handleConsoleMessages, handleNetworkRequests } from '../../mcp/tools/inspect'
import { handleWaitFor } from '../../mcp/tools/navigate'
import { handleHistory } from '../../mcp/tools/navigate'
import { handleReset } from '../../mcp/tools/reset'
import type { WindowInfo } from '../../mcp/types'
import { createGuest } from '../guestFixture'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const { createGuest } = await import('../guestFixture')
  const { default: snapshotFixture } = await import('../fixtures/form.json')
  const sessions = new Map<string, InstanceType<typeof EventEmitter>>()
  let sequence = 100
  const contents = () => {
    const { mock } = createGuest(sequence++)
    let url = 'about:blank'
    let initialized = false
    Object.assign(mock, {
      setUserAgent: vi.fn(),
      getZoomFactor: () => 1,
      getURL: () => url,
      getTitle: () => new URL(url).hostname,
      loadURL: vi.fn(async () => {
        initialized = true
      }),
      canGoBack: () => false,
      canGoForward: () => false,
      executeJavaScript: vi.fn(async () => null),
      setWindowOpenHandler: vi.fn()
    })
    mock.debugger.sendCommand.mockImplementation(async (method, params: any) => {
      if (method === 'Page.enable' && !initialized) throw new Error('Fresh BrowserView has no document')
      if (method === 'Page.getLayoutMetrics')
        return {
          cssContentSize: { x: 0, y: 0, width: 1000, height: 7000 },
          cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 800 }
        }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
      if (method === 'Page.captureScreenshot') return { data: Buffer.from(`tile:${params.clip.y}`).toString('base64') }
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { id: snapshotFixture.frameId, loaderId: url } } }
      if (method === 'Page.navigate') {
        url = params.url
        mock.debugger.emit('message', {}, 'Page.frameStartedLoading', { frameId: snapshotFixture.frameId })
        mock.debugger.emit('message', {}, 'Page.frameNavigated', {
          frame: { id: snapshotFixture.frameId, loaderId: url }
        })
        mock.debugger.emit('message', {}, 'Page.loadEventFired', {})
      }
      if (method === 'Accessibility.getFullAXTree') return { nodes: snapshotFixture.ax }
      if (method === 'DOM.getDocument') return { root: { backendNodeId: 1 } }
      if (method === 'Accessibility.queryAXTree')
        return {
          nodes: snapshotFixture.ax.filter(
            (node) =>
              (!params.role || node.role?.value === params.role) &&
              (!params.accessibleName || node.name?.value === params.accessibleName)
          )
        }
      if (method === 'DOMSnapshot.captureSnapshot') return snapshotFixture.dom
      if (method === 'Runtime.evaluate') {
        if (params.expression === 'window.devicePixelRatio') return { result: { value: 1 } }
        if (params.expression === '({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})')
          return { result: { value: snapshotFixture.viewport } }
        if (params.expression === 'document.title') return { result: { value: new URL(url).hostname } }
        if (params.expression === 'document.body.innerText') return { result: { value: 'Page content' } }
        return { result: { value: 'evaluated' } }
      }
      return {}
    })
    return mock
  }
  class Window extends EventEmitter {
    webContents = contents()
    destroyed = false
    show = vi.fn()
    addBrowserView = vi.fn()
    setTopBrowserView = vi.fn()
    removeBrowserView = vi.fn()
    getContentSize = () => [1200, 800]
    isDestroyed = () => this.destroyed
    close() {
      if (!this.destroyed) {
        this.destroyed = true
        this.emit('closed')
      }
    }
  }
  class View {
    webContents = contents()
    setBounds = vi.fn()
    setAutoResize = vi.fn()
  }
  return {
    session: {
      fromPartition: (partition: string) => {
        if (!sessions.has(partition))
          sessions.set(partition, Object.assign(new EventEmitter(), { getPartition: () => partition }))
        return sessions.get(partition)
      }
    },
    BrowserWindow: Window,
    BrowserView: View,
    app: Object.assign(new EventEmitter(), { isReady: vi.fn(() => true), whenReady: vi.fn(async () => undefined) }),
    webContents: { getAllWebContents: vi.fn(() => []) },
    nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
  }
})

let service: BrowserSessionService
let controllers: CdpBrowserController[]
const windows = new Map<string, BrowserWindow>()
let sequence = 0
beforeEach(async () => {
  BaseService.resetInstances()
  service = new BrowserSessionService()
  await service._doInit()
  controllers = []
  windows.clear()
  vi.mocked(app.isReady).mockReturnValue(true)
  vi.mocked(application.get).mockImplementation((name) => {
    if (name === 'BrowserSessionService') return service as never
    if (name === 'WindowManager')
      return {
        open: () => {
          const id = String(++sequence)
          windows.set(id, new BrowserWindow())
          return id
        },
        getWindow: (id: string) => windows.get(id),
        close: (id: string) => {
          windows.get(id)?.close()
          windows.delete(id)
        }
      } as never
    return application.getContainer().get(name)
  })
})
afterEach(async () => {
  for (const controller of controllers) await controller.dispose()
  await service._doStop()
})
const controller = () => {
  const c = new CdpBrowserController(service)
  controllers.push(c)
  return c
}

describe('MCP browser on shared sessions', () => {
  it.each(['console', 'network'])('starts inspection when %s is the first tool on a fresh page', async (kind) => {
    const c = controller()
    const { tabId, session } = await c.getSession()
    const command = vi.mocked(session.guest.debugger.sendCommand)
    const fallback = command.getMockImplementation()!
    command.mockImplementation(async (method, params) => {
      if (method === 'Runtime.enable')
        session.guest.debugger.emit('message', {}, 'Runtime.consoleAPICalled', {
          type: 'log',
          args: [{ type: 'string', value: 'Fresh page output' }],
          timestamp: 1,
          executionContextId: 1
        })
      if (method === 'Network.enable')
        session.guest.debugger.emit('message', {}, 'Network.requestWillBeSent', {
          requestId: 'fresh',
          type: 'Fetch',
          request: { method: 'GET', url: 'https://example.com/data' }
        })
      return fallback(method, params)
    })
    const result = await (kind === 'console' ? handleConsoleMessages : handleNetworkRequests)(c, { tabId })
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(data, JSON.stringify(data)).toMatchObject({ ok: true })
    if (kind === 'console') expect(data.messages).toContainEqual(expect.objectContaining({ text: 'Fresh page output' }))
    else expect(data.requests).toContainEqual(expect.objectContaining({ url: 'https://example.com/data' }))
  })

  it.each(['createTab', 'getSession'] as const)(
    'does not resurrect a window reset after %s obtained it',
    async (method) => {
      const c = controller()
      const windowsAccess = c as unknown as {
        getOrCreateWindow: (privateMode: boolean, showWindow?: boolean) => Promise<WindowInfo>
      }
      const getWindow = windowsAccess.getOrCreateWindow.bind(c)
      vi.spyOn(windowsAccess, 'getOrCreateWindow').mockImplementationOnce(async (...args) => {
        const info = await getWindow(...args)
        await c.reset(false)
        return info
      })

      await expect(c[method]()).rejects.toMatchObject({ code: 'debugger_unavailable' })
      expect(await c.listTabs()).toEqual([])
      expect(windows.size).toBe(0)
      const replacement = await c.createTab()
      expect(replacement.view.webContents.isDestroyed()).toBe(false)
    }
  )

  it.each([undefined, false])('cancels an opening window before completing reset (%s)', async (mode) => {
    const c = controller()
    const started = new Signal<void>()
    const resume = new Signal<void>()
    vi.mocked(app.isReady).mockReturnValue(false)
    vi.mocked(app.whenReady).mockImplementation(async () => {
      started.resolve()
      await resume
      vi.mocked(app.isReady).mockReturnValue(true)
    })
    const opening = expect(c.createTab()).rejects.toThrow('debugger_unavailable')
    await started
    let finished = false
    const resetting = c.reset(mode).then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    resume.resolve()
    await Promise.all([opening, resetting])
    expect(await c.listTabs()).toEqual([])
    expect(windows.size).toBe(0)
    const replacement = await c.createTab()
    expect((await c.listTabs())[0].tabId).toBe(replacement.tabId)
  })

  it('can go back to the initial blank history entry', async () => {
    const c = controller()
    const tab = await c.createTab()
    const guest = tab.view.webContents
    await guest.loadURL('about:blank')
    const command = vi.mocked(guest.debugger.sendCommand)
    const fallback = command.getMockImplementation()!
    command.mockImplementation(async (method, params) => {
      if (method === 'Page.getNavigationHistory')
        return {
          currentIndex: 1,
          entries: [
            { id: 1, url: 'about:blank' },
            { id: 2, url: 'https://example.com/' }
          ]
        }
      return fallback(method, params)
    })
    const result = await handleHistory(c, { tabId: tab.tabId }, -1)
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text), JSON.stringify(result)).toMatchObject({
      ok: true
    })
    expect(command).toHaveBeenCalledWith('Page.navigateToHistoryEntry', { entryId: 1 })
  })

  it('does not close unrelated tabs for an incomplete reset target', async () => {
    const c = controller()
    const normal = await c.createTab(false)
    const privateTab = await c.createTab(true)
    expect((await handleReset(c, { tabId: normal.tabId })).isError).toBe(true)
    expect((await handleReset(c, { tabId: '', privateMode: false })).isError).toBe(true)
    await expect(c.reset(undefined, normal.tabId)).rejects.toMatchObject({ code: 'not_allowed' })
    expect(normal.view.webContents.isDestroyed()).toBe(false)
    expect(privateTab.view.webContents.isDestroyed()).toBe(false)
    await c.reset(false, normal.tabId)
    expect(normal.view.webContents.isDestroyed()).toBe(true)
    expect(privateTab.view.webContents.isDestroyed()).toBe(false)
  })

  it('reports unknown close targets without closing another tab', async () => {
    const c = controller()
    const tab = await c.createTab()
    await expect(c.closeTab(false, 'unknown')).rejects.toMatchObject({ code: 'not_found' })
    await expect(c.closeTab(true, tab.tabId)).rejects.toMatchObject({ code: 'not_found' })
    expect(tab.view.webContents.isDestroyed()).toBe(false)
  })

  it('keeps a replacement window alive when a previous window finishes closing', async () => {
    const c = controller()
    await c.createTab()
    const oldWindow = [...windows.values()][0]
    const finishClose = oldWindow.close.bind(oldWindow)
    vi.spyOn(oldWindow, 'close').mockImplementation(() => undefined)
    await c.reset(false)
    const replacement = await c.createTab()
    try {
      finishClose()
      expect(replacement.view.webContents.isDestroyed()).toBe(false)
      expect((await c.getSession(false, replacement.tabId)).session.guest).toBe(replacement.view.webContents)
    } finally {
      finishClose()
    }
  })

  it('waits for resources already closing before disposal begins', async () => {
    const c = controller()
    const tab = await c.createTab()
    const guest = tab.view.webContents
    const finishGuest = vi.mocked(guest.close).getMockImplementation()!.bind(guest)
    vi.mocked(guest.close).mockImplementation(() => undefined)
    await c.reset(false)
    let stopped = false
    const closing = c.dispose().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    try {
      expect(stopped).toBe(false)
    } finally {
      finishGuest()
      await closing
    }
    expect(guest.isDestroyed()).toBe(true)
  })

  it('treats a ref from the previous document as gone after navigation', async () => {
    const c = controller()
    const { tabId } = await c.createTab()
    const { session } = await c.getSession(false, tabId)
    const before = await session.snapshot({ full: true })
    const ref = before.snapshot.nodes.find((node) => node.ref)!.ref!
    await c.open('https://example.com/next')
    const result = await handleWaitFor(c, { tabId, ref, gone: true })
    expect(result.isError).not.toBe(true)
    expect(JSON.parse((result.content[0] as { text: string }).text).ok).toBe(true)
    expect((await handleWaitFor(c, { tabId, ref, gone: false })).isError).toBe(true)
  })

  it('keeps disposal pending until Electron reports the managed page destroyed', async () => {
    const c = controller()
    const { view } = await c.createTab()
    const requested = new Signal<void>()
    const close = vi.mocked(view.webContents.close).getMockImplementation()!
    vi.mocked(view.webContents.close).mockImplementation(() => requested.resolve())
    let stopped = false
    const closing = c.dispose().then(() => {
      stopped = true
    })
    await requested
    await new Promise((resolve) => setImmediate(resolve))
    try {
      expect(stopped).toBe(false)
      expect(view.webContents.isDestroyed()).toBe(false)
    } finally {
      close.call(view.webContents)
      await closing
    }
    expect(view.webContents.isDestroyed()).toBe(true)
    expect(windows.size).toBe(0)
  })

  it('waits for an interrupted tool handler to finish its cleanup', async () => {
    const started = new Signal<void>()
    const resume = new Signal<void>()
    const execute = vi.spyOn(CdpBrowserController.prototype, 'execute').mockImplementation(async () => {
      started.resolve()
      await resume
      return 'finished'
    })
    const server = await service.createMcpServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'request-shutdown-test', version: '1' })
    await client.connect(ct)
    const request = expect(client.callTool({ name: 'execute', arguments: { code: '1' } })).rejects.toThrow()
    await started
    let stopped = false
    const stopping = service._doStop().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    try {
      expect(stopped).toBe(false)
    } finally {
      resume.resolve()
      await Promise.all([request, stopping])
      execute.mockRestore()
      await client.close()
    }
  })

  it('reports server shutdown failures after releasing remaining borrowed leases', async () => {
    const { guest, mock } = createGuest(1)
    const borrowed = service.acquire(guest, 'annotation', { ownership: 'borrowed' })
    await borrowed.send('Runtime.enable')
    const server = await service.createMcpServer()
    vi.spyOn(server, 'close').mockRejectedValueOnce(new Error('Transport close failed'))
    await expect(service._doStop()).rejects.toThrow('Failed to stop browser sessions')
    expect(mock.debugger.isAttached()).toBe(false)
    expect(mock.isDestroyed()).toBe(false)
    expect(service.get(guest.id)).toBeUndefined()
    expect(nativeTheme.listenerCount('updated')).toBe(0)
  })

  it('shares disposal completion and prevents late window creation from leaving resources behind', async () => {
    const started = new Signal<void>()
    const resume = new Signal<void>()
    vi.mocked(app.isReady).mockReturnValue(false)
    vi.mocked(app.whenReady).mockImplementation(async () => {
      started.resolve()
      await resume
      vi.mocked(app.isReady).mockReturnValue(true)
    })
    const c = controller()
    const opening = expect(c.createTab()).rejects.toThrow('debugger_unavailable')
    await started
    const closing = c.dispose()
    const repeated = c.dispose()
    let stopped = false
    void closing.then(() => {
      stopped = true
    })
    await Promise.resolve()
    try {
      expect(repeated).toBe(closing)
      expect(stopped).toBe(false)
    } finally {
      resume.resolve()
      await Promise.all([opening, closing])
    }
    expect(windows.size).toBe(0)
    expect(nativeTheme.listenerCount('updated')).toBe(0)
    await expect(c.createTab()).rejects.toThrow('debugger_unavailable')
  })

  it('waits for disconnect cleanup when the service stops during window creation', async () => {
    const started = new Signal<void>()
    const resume = new Signal<void>()
    vi.mocked(app.isReady).mockReturnValue(false)
    vi.mocked(app.whenReady).mockImplementation(async () => {
      started.resolve()
      await resume
      vi.mocked(app.isReady).mockReturnValue(true)
    })
    const server = await service.createMcpServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'shutdown-test', version: '1' })
    await client.connect(ct)
    const opening = expect(
      client.callTool({ name: 'open', arguments: { url: 'https://example.com' } })
    ).rejects.toThrow()
    await started
    await client.close()
    let stopped = false
    const stopping = service._doStop().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    try {
      expect(stopped).toBe(false)
    } finally {
      resume.resolve()
      await Promise.all([opening, stopping])
    }
    expect(windows.size).toBe(0)
    expect(nativeTheme.listenerCount('updated')).toBe(0)
  })

  it('coalesces concurrent window creation and keeps explicit tab and mode targeting isolated', async () => {
    const c = controller()
    const [a, b] = await Promise.all([
      c.open('https://a.example', 5000, false, true),
      c.open('https://b.example', 5000, false, true)
    ])
    expect(windows.size).toBe(1)
    expect(await c.execute('document.title', 5000, false, a.tabId)).toBe('a.example')
    expect(await c.execute('document.title', 5000, false, b.tabId)).toBe('b.example')
    await expect(c.execute('document.title', 5000, true, a.tabId)).rejects.toThrow('not_found')
    expect(windows.size).toBe(1)
    await c.closeTab(false, a.tabId)
    await expect(c.execute('document.title', 5000, false, a.tabId)).rejects.toThrow('not_found')
    expect(await c.execute('document.title', 5000, false, b.tabId)).toBe('b.example')
  })

  it('enforces guest budgets, destroys evicted pages, and releases the final window', async () => {
    const c = controller()
    const first = await c.createTab()
    for (let i = 0; i < 4; i++) await c.createTab()
    expect(first.view.webContents.isDestroyed()).toBe(true)
    expect(service.get(first.view.webContents.id)).toBeUndefined()
    expect(await c.listTabs()).toHaveLength(4)
    await c.reset()
    expect(await c.listTabs()).toEqual([])
    expect(windows.size).toBe(0)
  })

  it('keeps legacy open/execute outputs and exposes new tool schemas through the real MCP transport', async () => {
    const server = await createInMemoryMcpServer('@cherry/browser')
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'browser-test', version: '1' })
    await client.connect(clientTransport)
    try {
      const { tools } = await client.listTools()
      const names = tools.map((tool) => tool.name)
      expect(tools.find((tool) => tool.name === 'click')?.inputSchema.required).toEqual(['ref'])
      expect(tools.find((tool) => tool.name === 'type')?.inputSchema.required).toEqual(['ref', 'text'])
      expect(names).toEqual(
        expect.arrayContaining([
          'snapshot',
          'click',
          'type',
          'handle_dialog',
          'wait_for',
          'select_option',
          'find',
          'console_messages',
          'network_requests'
        ])
      )
      expect(names).not.toContain('upload_file')
      const opened = await client.callTool({ name: 'open', arguments: { url: 'https://example.com' } })
      const data = JSON.parse((opened.content as Array<{ text: string }>)[0].text)
      expect(data).toMatchObject({ currentUrl: 'https://example.com/', title: 'example.com' })
      const screenshot = await client.callTool({ name: 'screenshot', arguments: { tabId: data.tabId, fullPage: true } })
      expect(screenshot.isError).toBe(false)
      const content = screenshot.content as Array<{ type: string; text: string; data: string }>
      expect(
        content.filter((part) => part.type === 'image').map((part) => Buffer.from(part.data, 'base64').toString())
      ).toEqual(['tile:0', 'tile:1440', 'tile:2880', 'tile:4320'])
      const metadata = JSON.parse(content[0].text)
      expect(metadata.totalTiles).toBe(5)
      const remaining = await client.callTool({
        name: 'screenshot',
        arguments: { tabId: data.tabId, fullPage: true, cursor: metadata.nextCursor }
      })
      const rest = remaining.content as Array<{ type: string; text: string; data: string }>
      expect(
        rest.filter((part) => part.type === 'image').map((part) => Buffer.from(part.data, 'base64').toString())
      ).toEqual(['tile:5760'])
      expect(JSON.parse(rest[0].text).nextCursor).toBeUndefined()
      const result = await client.callTool({
        name: 'execute',
        arguments: { code: 'document.title', tabId: data.tabId }
      })
      expect(result.content).toEqual([{ type: 'text', text: 'example.com' }])
      const snapshot = await client.callTool({ name: 'snapshot', arguments: { tabId: data.tabId } })
      const first = JSON.parse((snapshot.content as Array<{ text: string }>)[0].text)
      expect(first, JSON.stringify(first)).toMatchObject({ ok: true, tabId: data.tabId })
      expect(first.snapshot).toContain('[e1]')
      const found = await client.callTool({
        name: 'find',
        arguments: { tabId: data.tabId, role: 'textbox', name: 'Name' }
      })
      expect(JSON.parse((found.content as Array<{ text: string }>)[0].text)).toMatchObject({
        ok: true,
        tabId: data.tabId,
        matches: [expect.objectContaining({ ref: 'e1', name: 'Name' })]
      })
      for (const name of ['console_messages', 'network_requests']) {
        const inspection = await client.callTool({ name, arguments: { tabId: data.tabId, clear: true } })
        expect(JSON.parse((inspection.content as Array<{ text: string }>)[0].text)).toMatchObject({
          ok: true,
          tabId: data.tabId,
          truncated: false,
          notice: expect.stringContaining('Untrusted')
        })
        expect((await client.callTool({ name, arguments: { tabId: 'missing' } })).isError).toBe(true)
      }
      expect((await client.callTool({ name: 'find', arguments: {} })).isError).toBe(true)
      expect((await client.callTool({ name: 'console_messages', arguments: { level: 'invalid' } })).isError).toBe(true)
      const repeated = await client.callTool({ name: 'snapshot', arguments: { tabId: data.tabId } })
      expect(JSON.parse((repeated.content as Array<{ text: string }>)[0].text).snapshot).toContain('(no change)')
      const stale = await client.callTool({ name: 'snapshot', arguments: { tabId: data.tabId, scope: 'e9999' } })
      expect(JSON.parse((stale.content as Array<{ text: string }>)[0].text)).toMatchObject({
        ok: false,
        error: 'stale_ref'
      })
      const obsolete = await client.callTool({ name: 'snapshot', arguments: { tabId: data.tabId, selector: '#old' } })
      expect(obsolete.isError).toBe(true)
      const unknown = await client.callTool({ name: 'constructor', arguments: {} })
      expect(unknown.isError).toBe(true)
      const missingWaitTarget = await client.callTool({ name: 'wait_for', arguments: {} })
      expect(missingWaitTarget.isError).toBe(true)
      const invalid = await client.callTool({ name: 'click', arguments: { ref: 'e0' } })
      expect(invalid.isError).toBe(true)
    } finally {
      await client.close()
      await service._doStop()
    }
    expect(windows.size).toBe(0)
    expect(nativeTheme.listenerCount('updated')).toBe(0)
  })

  it('reports a popup only after its new tab has navigated and preserves the source tab', async () => {
    const c = controller()
    const opened = await c.open('https://source.example')
    const { session } = await c.getSession(false, opened.tabId)
    const handler = vi.mocked(session.guest.setWindowOpenHandler).mock.calls[0][0]
    expect(handler({ url: 'https://child.example' } as never)).toEqual({ action: 'deny' })
    const newTabId = await c.takeNewTabId(false, opened.tabId)
    expect(newTabId).toBeTruthy()
    expect(await c.execute('document.title', 5000, false, newTabId)).toBe('child.example')
    expect(await c.execute('document.title', 5000, false, opened.tabId)).toBe('source.example')
    expect(windows.size).toBe(1)
  })

  it('preserves borrowed pages when controller and service shut down', async () => {
    const { guest, mock } = createGuest(1)
    const borrowed = service.acquire(guest, 'annotation', { ownership: 'borrowed' })
    await borrowed.send('Runtime.enable')
    await controller().open('https://example.com')
    await service._doStop()
    expect(mock.isDestroyed()).toBe(false)
    expect(mock.debugger.isAttached()).toBe(false)
  })
})
