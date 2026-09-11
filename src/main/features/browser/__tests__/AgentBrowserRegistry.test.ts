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
    const profile = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    Object.assign(profile, new EventEmitter())
    Object.setPrototypeOf(profile, EventEmitter.prototype)
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
    expect(() => service.agentBrowser.getCursor(sessionId, tabId, 'other' as WindowId)).toThrow(
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
      if (name === 'AgentSessionRuntimeService') return runtime as never
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

  it('ensures an explicitly requested HTML file in the artifact profile', async () => {
    service.agentBrowser.attach(sessionId, 1, windowId)
    const url = 'file:///workspace/local%20page.html'
    expect(controller.validateUrl(url)).toBe(url)
    const pending = service.agentBrowser.ensureGuest({ agentId, sessionId }, new AbortController().signal, url)
    expect(application.get('IpcApiService').broadcast).toHaveBeenLastCalledWith('browser.guest.ensure_requested', {
      sessionId,
      url
    })
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
    const annotation = service.acquire(fixture.guest, 'annotation', { ownership: 'borrowed' })
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

  it('navigates ordinary popup links in the same guest, including after Agent control is detached', async () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    events.emit('web-contents-created', {}, fixture.guest)
    const handler = vi.mocked(fixture.guest.setWindowOpenHandler).mock.calls.at(-1)![0]
    const url = 'https://www.bilibili.com/video/BV1Satr6zETw/?p=2#part'
    expect(handler({ url } as Electron.HandlerDetails)).toEqual({ action: 'deny' })
    await Promise.resolve()
    expect(fixture.guest.getURL()).toBe(url)
    expect(controller.takeHostEvents(tabId)).toEqual({})
    await application.get('PreferenceService').set('app.browser.agent_control.enabled', false)
    service.agentBrowser.detach(sessionId, tabId, windowId)
    const nextUrl = 'http://192.168.1.2:8080/reports'
    handler({ url: nextUrl } as Electron.HandlerDetails)
    await Promise.resolve()
    expect(fixture.guest.getURL()).toBe(nextUrl)
    expect(fixture.guest.setWindowOpenHandler).toHaveBeenCalledTimes(1)
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
