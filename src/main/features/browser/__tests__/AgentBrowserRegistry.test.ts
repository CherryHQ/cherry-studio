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

  it('repairs a detached binding through a targeted renderer attach', async () => {
    const old = service.agentBrowser.attach(sessionId, 1, windowId)
    service.agentBrowser.detach(sessionId, old.tabId, windowId)
    const signal = new AbortController()
    const pending = service.agentBrowser.ensureGuest({ agentId, sessionId }, signal.signal)
    const settled = pending.catch(() => undefined)
    try {
      await vi.waitFor(
        () =>
          expect(application.get('IpcApiService').send).toHaveBeenCalledWith(
            windowId,
            'browser.guest.ensure_requested',
            expect.objectContaining({ sessionId, repair: expect.objectContaining({ kind: 'reattach' }) })
          ),
        { timeout: 500 }
      )
      const call = vi
        .mocked(application.get('IpcApiService').send)
        .mock.calls.find((entry) => entry[1] === 'browser.guest.ensure_requested')!
      const payload = call[2] as { repair: { requestId: string } }
      const attach = service.agentBrowser.attach as (...args: unknown[]) => { tabId: string }
      const replacement = attach.call(service.agentBrowser, sessionId, 1, windowId, payload.repair.requestId)
      expect((await pending).tabId).toBe(replacement.tabId)
      expect(replacement.tabId).not.toBe(old.tabId)
      await expect(controller.getSession(false, old.tabId)).rejects.toMatchObject({ code: 'not_found' })
      expect(await controller.listTabs()).toHaveLength(1)
    } finally {
      signal.abort()
      await settled
    }
  })

  it('escalates an unacknowledged reattach repair to one recreate request', async () => {
    vi.useFakeTimers()
    try {
      const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
      service.agentBrowser.detach(sessionId, tabId, windowId)
      const send = vi.mocked(application.get('IpcApiService').send)
      const baseline = send.mock.calls.length
      const repairSends = () =>
        send.mock.calls
          .slice(baseline)
          .filter((call) => call[1] === 'browser.guest.ensure_requested')
          .map((call) => call[2] as { repair: { kind: string; requestId: string } })
          .map((payload) => payload.repair)
      const controller = new AbortController()
      const settled = service.agentBrowser.ensureGuest({ agentId, sessionId }, controller.signal).catch(() => undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(repairSends().map((repair) => repair.kind)).toEqual(['reattach'])

      await vi.advanceTimersByTimeAsync(2000)

      const repairs = repairSends()
      expect(repairs.map((repair) => repair.kind)).toEqual(['reattach', 'recreate'])
      expect(repairs[1].requestId).not.toBe(repairs[0].requestId)
      controller.abort(new Error('test-repair-escalated'))
      await settled
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a pending repair on abort and rejects its late attach token', async () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    service.agentBrowser.detach(sessionId, tabId, windowId)
    const controller = new AbortController()
    const pending = service.agentBrowser.ensureGuest({ agentId, sessionId }, controller.signal)
    const settled = pending.catch(() => undefined)
    try {
      await vi.waitFor(
        () =>
          expect(
            vi
              .mocked(application.get('IpcApiService').send)
              .mock.calls.some(
                (call) =>
                  call[1] === 'browser.guest.ensure_requested' &&
                  (call[2] as { repair?: { kind: string } }).repair?.kind === 'reattach'
              )
          ).toBe(true),
        { timeout: 500 }
      )
      const call = vi
        .mocked(application.get('IpcApiService').send)
        .mock.calls.findLast((entry) => entry[1] === 'browser.guest.ensure_requested')!
      const staleRequestId = (call[2] as { repair: { requestId: string } }).repair.requestId

      const reason = new Error('test-repair-aborted')
      controller.abort(reason)

      await expect(pending).rejects.toMatchObject({ message: 'test-repair-aborted' })
      expect(() => service.agentBrowser.attach(sessionId, 1, windowId, staleRequestId)).toThrow(
        expect.objectContaining({ code: 'not_allowed' })
      )
      expect(service.agentBrowser.get({ agentId, sessionId })).toBeUndefined()
    } finally {
      controller.abort()
      await settled
    }
  })

  it.each(['missing', 'destroyed'] as const)(
    'recreates a released guest immediately when its previous webContents is %s',
    async (previous) => {
      vi.useFakeTimers()
      const abort = new AbortController()
      try {
        service.agentBrowser.attach(sessionId, 1, windowId)
        fixture.mock.close()
        const replacement = createGuest(2)
        Object.assign(replacement.mock, {
          getType: () => 'webview',
          getZoomFactor: () => 1,
          hostWebContents: host,
          session: session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
        })
        vi.mocked(webContents.fromId).mockImplementation((id) =>
          id === 2 ? replacement.guest : previous === 'destroyed' ? fixture.guest : undefined
        )
        const send = vi.mocked(application.get('IpcApiService').send)
        const baseline = send.mock.calls.length
        const pending = service.agentBrowser.ensureGuest({ agentId, sessionId }, abort.signal)
        void pending.catch(() => undefined)
        const requests = send.mock.calls.slice(baseline).filter((call) => call[1] === 'browser.guest.ensure_requested')
        const repairs = requests.map(
          (call) => call[2] as { repair: { kind: string; requestId: string; expiresAt: number } }
        )
        expect(repairs.map(({ repair }) => repair.kind)).toEqual(['recreate'])
        const { requestId, expiresAt } = repairs[0].repair
        expect(expiresAt - Date.now()).toBe(10000)
        expect(service.agentBrowser.get({ agentId, sessionId })).toBeUndefined()
        expect(() => service.agentBrowser.attach(sessionId, 2, 'untrusted', requestId)).toThrow(
          expect.objectContaining({ code: 'not_allowed' })
        )
        expect(service.agentBrowser.get({ agentId, sessionId })).toBeUndefined()

        const { tabId } = service.agentBrowser.attach(sessionId, 2, windowId, requestId)
        const target = await pending
        expect(target.tabId).toBe(tabId)
        expect(target.guest).toBe(replacement.guest)
        const execution = target.beginExecution()
        expect(replacement.guest.getBackgroundThrottling()).toBe(false)
        execution.dispose()
        expect(replacement.guest.getBackgroundThrottling()).toBe(true)
        expect(() => service.agentBrowser.attach(sessionId, 2, windowId, requestId)).toThrow(
          expect.objectContaining({ code: 'not_allowed' })
        )
        expect(service.agentBrowser.get({ agentId, sessionId })).toBe(target)
      } finally {
        abort.abort()
        await vi.advanceTimersByTimeAsync(10000)
        vi.useRealTimers()
      }
    }
  )

  it.each([0, 1])(
    'cancels only repair waiter %s while the other waiter still receives a usable target',
    async (index) => {
      vi.useFakeTimers()
      const callers = [new AbortController(), new AbortController()]
      try {
        const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
        service.agentBrowser.detach(sessionId, tabId, windowId)
        const outcomes: unknown[] = []
        const pending = callers.map((caller, i) =>
          service.agentBrowser.ensureGuest({ agentId, sessionId }, caller.signal).then(
            (target) => (outcomes[i] = target),
            (error) => (outcomes[i] = error)
          )
        )
        const call = vi
          .mocked(application.get('IpcApiService').send)
          .mock.calls.findLast((entry) => entry[1] === 'browser.guest.ensure_requested')!
        const { requestId } = (call[2] as { repair: { requestId: string } }).repair
        const reason = new Error(`cancel-waiter-${index}`)
        callers[index].abort(reason)
        await vi.advanceTimersByTimeAsync(0)
        expect(outcomes[index]).toBe(reason)
        expect(outcomes[1 - index]).toBeUndefined()

        const repaired = service.agentBrowser.attach(sessionId, 1, windowId, requestId)
        await Promise.all(pending)
        expect(outcomes[1 - index]).toBe(service.agentBrowser.get({ agentId, sessionId }))
        expect(service.agentBrowser.get({ agentId, sessionId })?.tabId).toBe(repaired.tabId)
      } finally {
        for (const caller of callers) caller.abort()
        await vi.advanceTimersByTimeAsync(10000)
        vi.useRealTimers()
      }
    }
  )

  it('cancels the shared repair after both waiters abort and rejects its late token', async () => {
    vi.useFakeTimers()
    const callers = [new AbortController(), new AbortController()]
    try {
      const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
      service.agentBrowser.detach(sessionId, tabId, windowId)
      const outcomes: unknown[] = []
      const pending = callers.map((caller, i) =>
        service.agentBrowser.ensureGuest({ agentId, sessionId }, caller.signal).catch((error) => (outcomes[i] = error))
      )
      const send = vi.mocked(application.get('IpcApiService').send)
      const call = send.mock.calls.findLast((entry) => entry[1] === 'browser.guest.ensure_requested')!
      const { requestId } = (call[2] as { repair: { requestId: string } }).repair
      const reasons = [new Error('first-cancelled'), new Error('second-cancelled')]
      callers[0].abort(reasons[0])
      callers[1].abort(reasons[1])
      await vi.advanceTimersByTimeAsync(0)
      expect(outcomes[0]).toBe(reasons[0])
      expect(outcomes[1]).toBe(reasons[1])
      await Promise.all(pending)
      expect(() => service.agentBrowser.attach(sessionId, 1, windowId, requestId)).toThrow(
        expect.objectContaining({ code: 'not_allowed' })
      )
      expect(service.agentBrowser.get({ agentId, sessionId })).toBeUndefined()
      const sent = send.mock.calls.length
      await vi.advanceTimersByTimeAsync(10000)
      expect(send.mock.calls).toHaveLength(sent)
    } finally {
      for (const caller of callers) caller.abort()
      await vi.advanceTimersByTimeAsync(10000)
      vi.useRealTimers()
    }
  })

  it('bounds every shared repair waiter by the original ten-second deadline', async () => {
    vi.useFakeTimers()
    const callers = [new AbortController(), new AbortController()]
    try {
      const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
      service.agentBrowser.detach(sessionId, tabId, windowId)
      const outcomes: unknown[] = []
      const pending = callers.map((caller, i) =>
        service.agentBrowser.ensureGuest({ agentId, sessionId }, caller.signal).catch((error) => (outcomes[i] = error))
      )
      await vi.advanceTimersByTimeAsync(9999)
      expect(outcomes).toEqual([])
      const call = vi
        .mocked(application.get('IpcApiService').send)
        .mock.calls.findLast((entry) => entry[1] === 'browser.guest.ensure_requested')!
      const { requestId } = (call[2] as { repair: { requestId: string } }).repair
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all(pending)
      expect(outcomes).toEqual([
        expect.objectContaining({ code: 'timeout' }),
        expect.objectContaining({ code: 'timeout' })
      ])
      expect(() => service.agentBrowser.attach(sessionId, 1, windowId, requestId)).toThrow(
        expect.objectContaining({ code: 'not_allowed' })
      )
    } finally {
      for (const caller of callers) caller.abort()
      await vi.advanceTimersByTimeAsync(10000)
      vi.useRealTimers()
    }
  })

  it('keeps a healthy guest usable after a popup navigation rejects', async () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    vi.mocked(fixture.guest.loadURL).mockRejectedValueOnce(new Error('aborted'))
    service.agentBrowser.handlePopup(fixture.guest, { url: 'https://example.com/popup' } as Electron.HandlerDetails)
    await vi.waitFor(() =>
      expect(fixture.guest.debugger.sendCommand).toHaveBeenCalledWith('Page.getFrameTree', undefined)
    )
    expect(await controller.listTabs()).toHaveLength(1)
    expect((await controller.open('https://example.com/next')).tabId).toBe(tabId)
  })

  it('requests only one rebuild for an unresponsive popup guest', async () => {
    service.agentBrowser.attach(sessionId, 1, windowId)
    vi.mocked(fixture.guest.loadURL).mockRejectedValueOnce(new Error('aborted'))
    let frameRequests = 0
    vi.mocked(fixture.guest.debugger.sendCommand).mockImplementation(async (method) =>
      method === 'Page.getFrameTree'
        ? ++frameRequests === 1
          ? { frameTree: { frame: { id: 'main' } } }
          : { frameTree: {} }
        : {}
    )
    service.agentBrowser.handlePopup(fixture.guest, { url: 'https://example.com/popup' } as Electron.HandlerDetails)
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(application.get('IpcApiService').send)
          .mock.calls.some(
            (call) =>
              call[1] === 'browser.guest.ensure_requested' &&
              (call[2] as { repair?: { kind: string } }).repair?.kind === 'recreate'
          )
      ).toBe(true)
    )
    const calls = vi
      .mocked(application.get('IpcApiService').send)
      .mock.calls.filter(
        (call) =>
          call[1] === 'browser.guest.ensure_requested' &&
          (call[2] as { repair?: { kind: string } }).repair?.kind === 'recreate'
      )
    expect(calls).toHaveLength(1)
  })

  it('rejects unknown repair tokens before replacing a valid binding', () => {
    const original = service.agentBrowser.attach(sessionId, 1, windowId)
    expect(() => service.agentBrowser.attach(sessionId, 1, windowId, '11111111-1111-4111-8111-111111111111')).toThrow(
      expect.objectContaining({ code: 'not_allowed' })
    )
    expect(service.agentBrowser.get({ agentId, sessionId })?.tabId).toBe(original.tabId)
  })

  it('rejects POST popups and reports them once', () => {
    const { tabId } = service.agentBrowser.attach(sessionId, 1, windowId)
    expect(
      service.agentBrowser.handlePopup(fixture.guest, {
        url: 'https://example.com/',
        postBody: {}
      } as Electron.HandlerDetails)
    ).toBe(true)
    expect(controller.takeHostEvents(tabId)).toEqual({ popupUnsupported: true })
    expect(controller.takeHostEvents(tabId)).toEqual({})
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
