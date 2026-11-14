import { EventEmitter } from 'node:events'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { app, session, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { BaseService, Emitter, Signal } from '@main/core/lifecycle'
import type { WindowId } from '@shared/ipc/types'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { BrowserSessionService } from '../BrowserSessionService'
import { AgentBrowserController } from '../mcp/AgentBrowserController'
import { createGuest } from './guestFixture'

const agentId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const otherSessionId = '33333333-3333-4333-8333-333333333333'
const windowId = 'main:browser-test' as WindowId

describe('Agent browser authority and control lifetime', () => {
  const dbh = setupTestDatabase()
  let events: EventEmitter
  let service: BrowserSessionService
  let controller: AgentBrowserController
  let fixture: ReturnType<typeof createGuest>
  const host = { getZoomFactor: () => 1 } as Electron.WebContents

  beforeEach(async () => {
    events = new EventEmitter()
    vi.spyOn(app, 'on').mockImplementation((event, listener) => {
      events.on(event, listener)
      return app
    })
    vi.spyOn(app, 'removeListener').mockImplementation((event, listener) => {
      events.removeListener(event, listener)
      return app
    })
    dbh.db
      .insert(agentTable)
      .values({ id: agentId, name: 'Agent', type: 'claude-code', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/browser-test', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values(
        [sessionId, otherSessionId].map((id) => ({
          id,
          agentId,
          workspaceId: 'workspace',
          name: id,
          orderKey: id === sessionId ? 'a0' : 'a1'
        }))
      )
      .run()
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: host,
      on: vi.fn(),
      removeListener: vi.fn(),
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => false
    } as unknown as Electron.BrowserWindow)
    await application.get('PreferenceService').set('app.browser.agent_control.enabled', true)
    BaseService.resetInstances()
    service = new BrowserSessionService()
    await service._doInit()
    controller = new AgentBrowserController(service, service.agentBrowser, { agentId, sessionId })
    fixture = createGuest(1)
    Object.assign(fixture.mock, {
      getType: () => 'webview',
      getZoomFactor: () => 1,
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(async (url: string) => {
        fixture.mock.getURL.mockReturnValue(url)
      }),
      hostWebContents: host,
      session: session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser)),
      isLoadingMainFrame: () => true
    })
    vi.mocked(webContents.fromId).mockReturnValue(fixture.guest)
  })
  afterEach(async () => {
    await controller.dispose()
    await service._doStop()
    vi.restoreAllMocks()
  })

  it('rejects cursor acknowledgements from a different owner window', () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    expect(() => service.agentBrowser.getCursor(sessionId, tabId, 'other')).toThrow(
      expect.objectContaining({ code: 'not_allowed' })
    )
    expect(service.agentBrowser.getCursor(sessionId, 'old-tab', windowId)).toBeUndefined()
  })

  it('ends only the matching turn cursor while keeping the MCP connection and guest alive', async () => {
    const terminal = new Emitter<{
      sessionId: string
      assistantMessageId: string
      boundary: 'turn'
      status: 'success'
    }>()
    let messageId = 'new-turn'
    const runtime = { getLiveAssistantMessageId: () => messageId, onTurnTerminal: terminal.event }
    const container = application.getContainer()
    const get = container.get.bind(container)
    vi.spyOn(container, 'get').mockImplementation((name) => {
      if (name === 'AgentSessionRuntimeService') return runtime
      return get(name)
    })
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    const cursor = service.agentBrowser.getCursor(sessionId, tabId, windowId)!
    cursor.setPresented(true)
    const { pointer } = await controller.getSession(false, tabId)
    const pending = pointer.move({ x: 20, y: 20 }, {})
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    terminal.fire({ sessionId, assistantMessageId: 'old-turn', boundary: 'turn', status: 'success' })
    await Promise.resolve()
    expect(settled).toBe(false)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'not_found' })
    terminal.fire({ sessionId, assistantMessageId: messageId, boundary: 'turn', status: 'success' })
    await rejected
    expect(controller.signal.aborted).toBe(false)
    expect(service.agentBrowser.get({ sessionId, agentId })?.guest).toBe(fixture.guest)
    messageId = 'following-turn'
    const next = pointer.move({ x: 40, y: 40 }, {})
    const stopped = expect(next).rejects.toMatchObject({ code: 'not_found' })
    service.agentBrowser.detach(sessionId, tabId, windowId)
    await stopped
    expect(fixture.guest.isDestroyed()).toBe(false)
    terminal.dispose()
  })

  it.each([true, false])('restores original throttling %s after the last execution releases it', (original) => {
    fixture.guest.setBackgroundThrottling(original)
    service.agentBrowser.attach(sessionId, 1, windowId)
    const target = service.agentBrowser.get({ agentId, sessionId })!
    const first = target.beginExecution()
    const second = target.beginExecution()
    expect(fixture.guest.getBackgroundThrottling()).toBe(false)
    first.dispose()
    first.dispose()
    expect(fixture.guest.getBackgroundThrottling()).toBe(false)
    second.dispose()
    expect(fixture.guest.getBackgroundThrottling()).toBe(original)
  })

  it('restores throttling when the guest binding is revoked during execution', () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    const target = service.agentBrowser.get({ agentId, sessionId })!
    const execution = target.beginExecution()
    service.agentBrowser.detach(sessionId, tabId, windowId)
    expect(fixture.guest.getBackgroundThrottling()).toBe(true)
    execution.dispose()
    expect(() => target.beginExecution()).toThrow()
    expect(fixture.guest.isDestroyed()).toBe(false)
  })

  it('releases execution throttling at the end of a tool while retaining the browser', async () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    await controller.getSession(false, tabId)
    expect(fixture.guest.getBackgroundThrottling()).toBe(false)
    controller.finishTool()
    expect(fixture.guest.getBackgroundThrottling()).toBe(true)
    expect(service.agentBrowser.get({ agentId, sessionId })?.tabId).toBe(tabId)
    await controller.getSession(false, tabId)
    expect(fixture.guest.getBackgroundThrottling()).toBe(false)
    await controller.dispose()
    expect(fixture.guest.getBackgroundThrottling()).toBe(true)
  })

  it('releases borrowed observers when Electron destroys their guest', async () => {
    const guestSession = fixture.mock.session
    const initialListeners = guestSession.listenerCount('will-download')
    const debuggerEvents = fixture.mock.debugger
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    await controller.getSession(false, tabId)
    const cursor = service.agentBrowser.getCursor(sessionId, tabId, windowId)!
    cursor.setPresented(true)
    const pending = cursor.move({ x: 20, y: 20 }, 'document-1', {})
    const canceled = expect(pending).rejects.toMatchObject({ code: 'not_found' })
    expect(guestSession.listenerCount('will-download')).toBe(initialListeners + 1)

    expect(() => fixture.mock.close()).not.toThrow()
    await canceled
    expect(debuggerEvents.listenerCount('message')).toBe(0)
    expect(debuggerEvents.listenerCount('detach')).toBe(0)
    expect(service.agentBrowser.get({ agentId, sessionId })).toBeUndefined()
    expect(guestSession.listenerCount('will-download')).toBe(initialListeners)
    expect(service.get(fixture.guest.id)).toBeUndefined()
  })

  it('ensures an explicitly requested HTML file in the artifact profile', async () => {
    service.agentBrowser.attach(sessionId, 1, windowId)
    const url = 'file:///workspace/local%20page.html'
    expect(controller.validateUrl(url)).toBe(url)
    const pending = service.agentBrowser.ensureGuest({ agentId, sessionId }, new AbortController().signal, url)
    expect(application.get('IpcApiService').broadcast).toHaveBeenLastCalledWith(
      'browser.guest.ensure_requested',
      expect.objectContaining({
        sessionId,
        url,
        pageId: sessionId,
        action: 'navigate'
      })
    )
    const artifact = createGuest(2)
    Object.assign(artifact.mock, {
      getType: () => 'webview',
      getZoomFactor: () => 1,
      hostWebContents: host,
      session: session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentHtmlArtifact))
    })
    artifact.mock.getURL.mockReturnValue(url)
    vi.mocked(webContents.fromId).mockReturnValue(artifact.guest)
    service.agentBrowser.attach(sessionId, 2, windowId)
    expect((await pending).guest).toBe(artifact.guest)
  })

  it('revokes control after the built-in tool is disabled without closing the page', async () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    expect((await controller.getSession(false, tabId)).session.guest).toBe(fixture.guest)
    dbh.db
      .update(agentTable)
      .set({ disabledTools: ['mcp__browser'] })
      .where(eq(agentTable.id, agentId))
      .run()
    await expect(controller.getSession(false, tabId)).rejects.toMatchObject({ code: 'not_allowed' })
    expect(fixture.guest.isDestroyed()).toBe(false)
  })

  it('rejects foreign hosts, unsupported profiles and cross-session target IDs', async () => {
    Object.assign(fixture.mock, { hostWebContents: {} })
    expect(() => service.agentBrowser.attach(sessionId, 1, windowId)).toThrow('not_allowed')
    Object.assign(fixture.mock, { hostWebContents: host, session: session.fromPartition('persist:default') })
    expect(() => service.agentBrowser.attach(sessionId, 1, windowId)).toThrow('not_allowed')
    Object.assign(fixture.mock, {
      session: session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    })
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    expect(() => service.agentBrowser.attach(otherSessionId, 1, windowId)).toThrow('not_allowed')
    const other = new AgentBrowserController(service, service.agentBrowser, { agentId, sessionId: otherSessionId })
    await expect(other.getSession(false, tabId)).rejects.toMatchObject({ code: 'not_found' })
    await expect(controller.getSession(true, tabId)).rejects.toMatchObject({ code: 'not_allowed' })
    await other.dispose()
    expect((await controller.getSession(false, tabId)).session.guest).toBe(fixture.guest)
  })

  it('revokes old target IDs and cancels work while an annotation lease keeps the debugger alive', async () => {
    const annotation = await service.acquire(fixture.guest, 'annotation', { ownership: 'borrowed' })
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    await controller.getSession(false, tabId)
    const started = new Signal<void>()
    fixture.mock.debugger.sendCommand.mockImplementation(async (method) => {
      if (method === 'Runtime.evaluate') {
        started.resolve()
        return new Promise(() => undefined)
      }
      return {}
    })
    const active = controller.execute('new Promise(() => {})', 30_000, false, tabId)
    const rejected = expect(active).rejects.toMatchObject({ code: 'not_found' })
    await started
    service.agentBrowser.detach(sessionId, tabId, windowId)
    await rejected
    expect(service.agentBrowser.get({ agentId, sessionId })).toBeUndefined()
    expect(annotation.isAvailable()).toBe(true)
    expect(fixture.mock.isDestroyed()).toBe(false)
    const replacement = service.agentBrowser.attach(sessionId, 1, windowId)
    expect(replacement.tabId).not.toBe(tabId)
    await expect(controller.getSession(false, tabId)).rejects.toMatchObject({ code: 'not_found' })
    service.release(fixture.guest, 'annotation')
    fixture.mock.close()
  })

  it('rejects control after disablement and never closes the user page on disconnect', async () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    await controller.getSession(false, tabId)
    await application.get('PreferenceService').set('app.browser.agent_control.enabled', false)
    await expect(controller.execute('document.title', 1000, false, tabId)).rejects.toMatchObject({
      code: 'not_allowed'
    })
    await controller.dispose()
    expect(service.get(fixture.guest.id)).toBeUndefined()
    expect(fixture.mock.isDestroyed()).toBe(false)
    expect(service.agentBrowser.get({ agentId, sessionId })?.tabId).toBe(tabId)
  })

  it.each(['foreground-tab', 'background-tab'] as const)(
    'opens an ordinary popup in a conversation page with %s intent',
    async (disposition) => {
      const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
      events.emit('web-contents-created', {}, fixture.guest)
      const handler = vi.mocked(fixture.guest.setWindowOpenHandler).mock.calls.at(-1)![0]
      const url = 'https://example.org/report#part'
      expect(handler({ url, disposition } as Electron.HandlerDetails)).toEqual({ action: 'deny' })
      expect(fixture.guest.getURL()).toBe('https://example.com')
      expect(application.get('IpcApiService').send).toHaveBeenLastCalledWith(
        windowId,
        'browser.guest.ensure_requested',
        expect.objectContaining({
          sessionId,
          url,
          scope: 'agent',
          pageId: expect.any(String),
          action: 'create',
          activate: disposition !== 'background-tab'
        })
      )
      expect(controller.takeHostEvents(tabId)).toEqual({})
      await application.get('PreferenceService').set('app.browser.agent_control.enabled', false)
      service.agentBrowser.detach(sessionId, tabId, windowId)
      expect(handler({ url, disposition } as Electron.HandlerDetails)).toEqual({ action: 'deny' })
      expect(fixture.guest.getURL()).toBe('https://example.com')
    }
  )

  function attachPage(pageId: string, id = 2, owner = sessionId) {
    const page = createGuest(id)
    Object.assign(page.mock, {
      getType: () => 'webview',
      getZoomFactor: () => 1,
      hostWebContents: host,
      session: session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    })
    vi.mocked(webContents.fromId).mockReturnValue(page.guest)
    const binding = service.agentBrowser.attach(owner, id, windowId, pageId)
    return { ...page, ...binding }
  }

  it('keeps observed element refs usable across page switches and releases each page independently', async () => {
    const first = service.agentBrowser.attach(sessionId, 1, windowId, 'page-one')
    const second = attachPage('page-two')
    for (const [page, nodeId] of [
      [fixture, 41],
      [second, 42]
    ] as const) {
      const send = page.mock.debugger.sendCommand.getMockImplementation()!
      page.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
        if (method === 'Accessibility.getFullAXTree')
          return {
            nodes: [
              { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['button'] },
              {
                nodeId: 'button',
                parentId: 'root',
                backendDOMNodeId: nodeId,
                role: { value: 'button' },
                name: { value: 'Submit' }
              }
            ]
          }
        if (method === 'DOMSnapshot.captureSnapshot')
          return {
            strings: ['main', 'BUTTON', 'auto', 'block', 'visible', '1'],
            documents: [
              {
                frameId: 0,
                nodes: { backendNodeId: [nodeId], nodeName: [1], attributes: [[]], parentIndex: [-1] },
                layout: { nodeIndex: [0], bounds: [[0, 0, 80, 20]], styles: [[2, 3, 4, 5, 2]] }
              }
            ]
          }
        if (method === 'Runtime.evaluate') return { result: { value: { x: 0, y: 0, w: 800, h: 600 } } }
        return send(method, params)
      })
    }
    const observed = await controller.getSession(false, first.tabId)
    const snapshot = await observed.session.snapshot({ full: true })
    const ref = snapshot.snapshot.nodes.find((node) => node.role === 'button')?.ref
    if (!ref) throw new Error('The visible Submit button must have an element ref')
    const other = await controller.getSession(false, second.tabId)
    await other.session.snapshot({ full: true })
    const resumed = await controller.getSession(false, first.tabId)
    expect(resumed.session.resolveRef(ref)).toBe(41)
    service.agentBrowser.detach(sessionId, first.tabId, windowId)
    await expect(controller.getSession(false, first.tabId)).rejects.toMatchObject({ code: 'not_found' })
    expect((await controller.getSession(false, second.tabId)).session.isAvailable()).toBe(true)
    await controller.dispose()
    expect(service.get(second.guest.id)).toBeUndefined()
    expect(second.guest.isDestroyed()).toBe(false)
  })

  it('keeps exact handles independent and refuses a closed default instead of targeting its neighbor', async () => {
    const first = service.agentBrowser.attach(sessionId, 1, windowId, 'page-one')
    await controller.getSession()
    const second = attachPage('page-two')
    const firstSend = fixture.mock.debugger.sendCommand.getMockImplementation()!
    const secondSend = second.mock.debugger.sendCommand.getMockImplementation()!
    fixture.mock.debugger.sendCommand.mockImplementation(async (method, params) =>
      method === 'Runtime.evaluate' ? { result: { value: 'first' } } : firstSend(method, params)
    )
    second.mock.debugger.sendCommand.mockImplementation(async (method, params) =>
      method === 'Runtime.evaluate' ? { result: { value: 'second' } } : secondSend(method, params)
    )
    expect(await controller.execute('document.title', 1000, false, first.tabId)).toBe('first')
    expect(await controller.execute('document.title', 1000, false, second.tabId)).toBe('second')
    expect(await controller.execute('document.title')).toBe('first')
    expect(await controller.listTabs()).toHaveLength(2)
    service.agentBrowser.detach(sessionId, first.tabId, windowId)
    await expect(controller.execute('document.title')).rejects.toMatchObject({ code: 'not_found' })
    await expect(controller.execute('document.title', 1000, false, first.tabId)).rejects.toMatchObject({
      code: 'not_found'
    })
    expect(await controller.execute('document.title', 1000, false, second.tabId)).toBe('second')
  })

  it('replacing one page revokes only that generation and rejects another conversation target', async () => {
    const first = service.agentBrowser.attach(sessionId, 1, windowId, 'page-one')
    const second = attachPage('page-two')
    const replacement = attachPage('page-one', 3)
    expect((await controller.listTabs()).map((tab) => tab.tabId)).toEqual(
      expect.arrayContaining([replacement.tabId, second.tabId])
    )
    await expect(controller.getSession(false, first.tabId)).rejects.toMatchObject({ code: 'not_found' })
    expect((await controller.getSession(false, second.tabId)).session.guest).toBe(second.guest)
    const other = attachPage('other-page', 4, otherSessionId)
    await expect(controller.getSession(false, other.tabId)).rejects.toMatchObject({ code: 'not_found' })
    expect(service.agentBrowser.list({ sessionId: otherSessionId, ownerId: agentId })).toHaveLength(1)
  })

  it.each(['javascript:alert(1)', 'file:///tmp/index.html', 'https://user:pass@example.com', 'about:blank'])(
    'blocks unsupported popup %s without navigating and reports it once',
    (url) => {
      const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
      expect(service.agentBrowser.handlePopup(fixture.guest, { url } as Electron.HandlerDetails)).toBe(true)
      expect(fixture.guest.getURL()).toBe('https://example.com')
      expect(controller.takeHostEvents(tabId)).toEqual({ popupUnsupported: true })
      expect(controller.takeHostEvents(tabId)).toEqual({})
    }
  )

  it.each([WebviewSecurityProfile.AgentDevPreview, WebviewSecurityProfile.AgentHtmlArtifact])(
    'keeps popup navigation disabled for %s',
    (profile) => {
      fixture.mock.session = session.fromPartition(getWebviewPartition(profile))
      const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
      events.emit('web-contents-created', {}, fixture.guest)
      const handler = vi.mocked(fixture.guest.setWindowOpenHandler).mock.calls.at(-1)![0]
      expect(handler({ url: 'https://www.bilibili.com' } as Electron.HandlerDetails)).toEqual({ action: 'deny' })
      expect(fixture.guest.getURL()).toBe('https://example.com')
      expect(controller.takeHostEvents(tabId)).toEqual({ popupUnsupported: true })
    }
  )
})
