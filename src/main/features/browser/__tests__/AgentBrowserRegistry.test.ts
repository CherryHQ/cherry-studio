import { EventEmitter } from 'node:events'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { BaseService, Signal } from '@main/core/lifecycle'
import type { WindowId } from '@shared/ipc/types'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { app, session, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  const host = {} as Electron.WebContents

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
      webContents: host
    } as Electron.BrowserWindow)
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
    expect(service.agentBrowser.list()).toEqual([{ sessionId, title: 'Test page' }])
    expect(annotation.isAvailable()).toBe(true)
    expect(fixture.mock.isDestroyed()).toBe(false)
    const replacement = service.agentBrowser.attach(sessionId, 1, windowId)
    expect(replacement.tabId).not.toBe(tabId)
    await expect(controller.getSession(false, tabId)).rejects.toMatchObject({ code: 'not_found' })
    service.release(fixture.guest, 'annotation')
    fixture.mock.close()
    expect(service.agentBrowser.list()).toEqual([])
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
