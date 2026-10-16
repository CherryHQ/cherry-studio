import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { session, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { BaseService, Signal } from '@main/core/lifecycle'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { EventPayload, WindowId } from '@shared/ipc/types'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { BrowserSessionService } from '../BrowserSessionService'
import { SessionBrowserController } from '../mcp/SessionBrowserController'
import { BrowserSessionError } from '../session/BrowserSessionError'
import { createGuest } from './guestFixture'

const topicId = '22222222-2222-4222-8222-222222222222'
const secondTopic = '33333333-3333-4333-8333-333333333333'
const assistantId = '11111111-1111-4111-8111-111111111111'
const windowId = 'main:browser-test' as WindowId

describe('topic browser ownership and cancellation', () => {
  const dbh = setupTestDatabase()
  let service: BrowserSessionService
  beforeEach(async () => {
    dbh.db
      .insert(assistantTable)
      .values({ id: assistantId, name: 'Assistant', emoji: '', orderKey: 'a0', settings: DEFAULT_ASSISTANT_SETTINGS })
      .run()
    dbh.db
      .insert(topicTable)
      .values([topicId, secondTopic].map((id, i) => ({ id, assistantId, orderKey: `a${i}` })))
      .run()
    await application.get('PreferenceService').set('app.browser.agent_control.enabled', true)
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    BaseService.resetInstances()
    service = new BrowserSessionService()
    await service._doInit()
  })
  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function attachTopicGuest(profile: WebviewSecurityProfile = WebviewSecurityProfile.AgentBrowser, guestId = 71) {
    const host = { getZoomFactor: () => 1 } as Electron.WebContents
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: host,
      on: vi.fn(),
      removeListener: vi.fn(),
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => false
    } as unknown as Electron.BrowserWindow)
    const fixture = createGuest(guestId)
    Object.assign(fixture.mock, {
      getType: () => 'webview',
      getZoomFactor: () => 1,
      hostWebContents: host,
      session: session.fromPartition(getWebviewPartition(profile))
    })
    vi.mocked(webContents.fromId).mockReturnValue(fixture.guest)
    const { tabId } = service.topicBrowser.attach(topicId, guestId, windowId)
    return { fixture, tabId }
  }

  it.each(['focused', 'background'] as const)(
    'accepts %s keyboard input after a topic changes assistant',
    async (status) => {
      vi.useRealTimers()
      const { fixture, tabId } = attachTopicGuest()
      const oldControl = service.createControl({ kind: 'topic', sessionId: topicId, ownerId: assistantId })
      const newOwner = '44444444-4444-4444-8444-444444444444'
      dbh.db
        .insert(assistantTable)
        .values({ id: newOwner, name: 'New owner', emoji: '', orderKey: 'a1', settings: DEFAULT_ASSISTANT_SETTINGS })
        .run()
      dbh.db.update(topicTable).set({ assistantId: newOwner }).where(eq(topicTable.id, topicId)).run()
      const control = service.createControl({ kind: 'topic', sessionId: topicId, ownerId: newOwner })
      let input = ''
      const send = fixture.mock.debugger.sendCommand.getMockImplementation()!
      fixture.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
        if (method === 'Input.dispatchKeyEvent' && (params as { type: string }).type === 'char')
          input += (params as { text: string }).text
        return send(method, params)
      })
      vi.mocked(application.get('IpcApiService').send).mockImplementation((eventWindow, event, payload) => {
        if (event !== 'browser.input.focus_requested') return
        const request = payload as EventPayload<'browser.input.focus_requested'>
        service.topicBrowser.inputFocused(request.sessionId, request.tabId, request.requestId, status, eventWindow)
      })
      try {
        await expect(
          oldControl.execute('pressKey', { key: 'x' }, tabId, new AbortController().signal)
        ).rejects.toMatchObject({ code: 'not_allowed' })
        expect(input).toBe('')
        await control.execute('pressKey', { key: 'x' }, tabId, new AbortController().signal)
        expect(input).toBe('x')
        expect(service.topicBrowser.get({ sessionId: topicId, ownerId: newOwner })?.tabId).toBe(tabId)
      } finally {
        await oldControl.close()
        await control.close()
      }
    }
  )

  it.each(['cancel', 'owner-change', 'detach', 'unavailable'] as const)(
    'rejects keyboard input when %s occurs during focus acknowledgement',
    async (failure) => {
      vi.useRealTimers()
      const { fixture, tabId } = attachTopicGuest()
      const control = service.createControl({ kind: 'topic', sessionId: topicId, ownerId: assistantId })
      const abort = new AbortController()
      let inputs = 0
      const send = fixture.mock.debugger.sendCommand.getMockImplementation()!
      fixture.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
        if (method.startsWith('Input.')) inputs++
        return send(method, params)
      })
      vi.mocked(application.get('IpcApiService').send).mockImplementation((eventWindow, event, payload) => {
        if (event !== 'browser.input.focus_requested') return
        const request = payload as EventPayload<'browser.input.focus_requested'>
        if (failure === 'cancel') abort.abort(new Error('cancelled'))
        if (failure === 'detach') service.topicBrowser.detach(topicId, tabId, windowId)
        if (failure === 'owner-change') {
          const next = '44444444-4444-4444-8444-444444444444'
          dbh.db
            .insert(assistantTable)
            .values({ id: next, name: 'Next', emoji: '', orderKey: 'a1', settings: DEFAULT_ASSISTANT_SETTINGS })
            .run()
          dbh.db.update(topicTable).set({ assistantId: next }).where(eq(topicTable.id, topicId)).run()
        }
        service.topicBrowser.inputFocused(
          request.sessionId,
          request.tabId,
          request.requestId,
          failure === 'unavailable' ? 'unavailable' : 'background',
          eventWindow
        )
      })
      try {
        await expect(control.execute('pressKey', { key: 'x' }, tabId, abort.signal)).rejects.toThrow()
        expect(inputs).toBe(0)
      } finally {
        await control.close()
      }
    }
  )

  it('returns a usable tab handle when the first observation opens a dialog', async () => {
    vi.useRealTimers()
    const { fixture, tabId } = attachTopicGuest()
    const control = service.createControl({ kind: 'topic', sessionId: topicId, ownerId: assistantId })
    let opened = false
    let accepted: boolean | undefined
    fixture.mock.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'document-1' } } }
      if (method === 'Accessibility.getFullAXTree') {
        if (!opened) {
          opened = true
          fixture.mock.debugger.emit('message', {}, 'Page.javascriptDialogOpening', {
            type: 'confirm',
            message: 'Continue?'
          })
        }
        return { nodes: [] }
      }
      if (method === 'DOMSnapshot.captureSnapshot')
        return {
          strings: ['main'],
          documents: [
            {
              frameId: 0,
              nodes: { backendNodeId: [], nodeName: [], attributes: [] },
              layout: { nodeIndex: [], bounds: [], styles: [] }
            }
          ]
        }
      if (method === 'Runtime.evaluate') return { result: { value: { x: 0, y: 0, w: 800, h: 600 } } }
      if (method === 'Page.handleJavaScriptDialog') accepted = (params as { accept: boolean }).accept
      return {}
    })
    const signal = new AbortController().signal
    try {
      const initial = await control.execute('getTab', {}, undefined, signal)
      expect(initial).toMatchObject({
        observation: true,
        value: { tabId, complete: false, dialog: { type: 'confirm', message: 'Continue?' } }
      })
      await control.execute('handleDialog', { accept: false }, initial.value.tabId as string, signal)
      expect(accepted).toBe(false)
      const recovered = await control.execute('getAXState', {}, initial.value.tabId as string, signal)
      expect(recovered.value).toMatchObject({ tabId, complete: true })
      expect(recovered.value).not.toHaveProperty('dialog')
    } finally {
      await control.close()
    }
  })

  it('completes artifact-to-web navigation while invalidating the old handle', async () => {
    const old = attachTopicGuest(WebviewSecurityProfile.AgentHtmlArtifact)
    const control = service.createControl({ kind: 'topic', sessionId: topicId, ownerId: assistantId })
    let replacement: ReturnType<typeof attachTopicGuest> | undefined
    let navigatedUrl = 'about:blank'
    vi.mocked(application.get('IpcApiService').broadcast).mockImplementation((event) => {
      if (event !== 'browser.guest.ensure_requested') return
      replacement = attachTopicGuest(WebviewSecurityProfile.AgentBrowser, 72)
      const next = replacement.fixture.mock
      next.getURL.mockImplementation(() => navigatedUrl)
      next.debugger.sendCommand.mockImplementation(async (method, params) => {
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'document-1' } } }
        if (method === 'Page.navigate') {
          navigatedUrl = (params as { url: string }).url
          next.debugger.emit('message', {}, 'Page.frameStartedLoading', { frameId: 'main' })
          next.debugger.emit('message', {}, 'Page.loadEventFired', {})
        }
        return {}
      })
    })
    const signal = new AbortController().signal
    try {
      const result = await control.execute('goto', { url: 'https://example.com' }, old.tabId, signal)
      expect(navigatedUrl).toBe('https://example.com/')
      expect(result.value).toMatchObject({ tabId: replacement?.tabId, handleInvalidated: true })
      expect(signal.aborted).toBe(false)
      await expect(control.execute('goto', { url: 'https://example.org' }, old.tabId, signal)).rejects.toMatchObject({
        code: 'not_found'
      })
      expect(navigatedUrl).toBe('https://example.com/')
    } finally {
      await control.close()
    }
  })

  it('preserves caller cancellation while waiting for a replacement guest', async () => {
    const old = attachTopicGuest(WebviewSecurityProfile.AgentHtmlArtifact)
    const control = service.createControl({ kind: 'topic', sessionId: topicId, ownerId: assistantId })
    const abort = new AbortController()
    const cancelled = new Error('cancelled by user')
    vi.mocked(application.get('IpcApiService').broadcast).mockImplementation((event) => {
      if (event === 'browser.guest.ensure_requested') abort.abort(cancelled)
    })
    try {
      await expect(control.execute('goto', { url: 'https://example.com' }, old.tabId, abort.signal)).rejects.toBe(
        cancelled
      )
      expect(service.topicBrowser.get({ sessionId: topicId, ownerId: assistantId })?.tabId).toBe(old.tabId)
    } finally {
      await control.close()
    }
  })

  it('confines targets to their topic and window while allowing the topic to move between assistants', async () => {
    const { fixture, tabId } = attachTopicGuest()
    expect(service.topicBrowser.get({ sessionId: secondTopic, ownerId: assistantId })).toBeUndefined()
    expect(() => service.topicBrowser.attach(secondTopic, 71, windowId)).toThrow()
    expect(() => service.topicBrowser.getCursor(topicId, tabId, 'other')).toThrow()
    const result = await service.callTopicTool(topicId, assistantId, 'list_tabs', {}, new AbortController().signal)
    expect(JSON.stringify(result)).toContain(tabId)
    dbh.db
      .update(assistantTable)
      .set({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableBrowser: false } })
      .where(eq(assistantTable.id, assistantId))
      .run()
    await expect(
      service.callTopicTool(topicId, assistantId, 'list_tabs', {}, new AbortController().signal)
    ).rejects.toThrow()
    const newOwner = '44444444-4444-4444-8444-444444444444'
    dbh.db
      .insert(assistantTable)
      .values({ id: newOwner, name: 'New owner', emoji: '', orderKey: 'a1', settings: DEFAULT_ASSISTANT_SETTINGS })
      .run()
    dbh.db.update(topicTable).set({ assistantId: newOwner }).where(eq(topicTable.id, topicId)).run()
    const moved = await Promise.all(
      [1, 2].map(() => service.callTopicTool(topicId, newOwner, 'list_tabs', {}, new AbortController().signal))
    )
    expect(moved.every((result) => !result.isError && JSON.stringify(result).includes(tabId))).toBe(true)
    expect(() => service.topicBrowser.get({ sessionId: topicId, ownerId: assistantId })).toThrow()
    expect(fixture.guest.isDestroyed()).toBe(false)
  })

  it.each(['topic', 'assistant'] as const)('rejects tools after their %s is deleted', async (entity) => {
    attachTopicGuest()
    if (entity === 'topic') dbh.db.delete(topicTable).where(eq(topicTable.id, topicId)).run()
    else dbh.db.delete(assistantTable).where(eq(assistantTable.id, assistantId)).run()

    await expect(
      service.callTopicTool(topicId, assistantId, 'list_tabs', {}, new AbortController().signal)
    ).rejects.toThrow(new BrowserSessionError('not_allowed'))
  })

  it('rejects deleted topic bindings without requesting a replacement guest', async () => {
    attachTopicGuest()
    dbh.db.delete(topicTable).where(eq(topicTable.id, topicId)).run()
    const context = { sessionId: topicId, ownerId: assistantId }
    const denied = new BrowserSessionError('not_allowed')
    const broadcast = vi.mocked(application.get('IpcApiService').broadcast)
    broadcast.mockClear()

    expect(() => service.topicBrowser.get(context)).toThrow(denied)
    expect(() => service.topicBrowser.attach(topicId, 71, windowId)).toThrow(denied)
    await expect(service.topicBrowser.ensureGuest(context, new AbortController().signal)).rejects.toThrow(denied)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it.each(['topic', 'assistant'] as const)('rechecks deleted %s before queued dispatch', async (entity) => {
    attachTopicGuest()
    const pending = service.callTopicTool(topicId, assistantId, 'list_tabs', {}, new AbortController().signal)
    if (entity === 'topic') dbh.db.delete(topicTable).where(eq(topicTable.id, topicId)).run()
    else dbh.db.delete(assistantTable).where(eq(assistantTable.id, assistantId)).run()

    await expect(pending).rejects.toThrow(new BrowserSessionError('not_allowed'))
  })

  it.each(['topic', 'assistant'] as const)('preserves unexpected %s lookup failures', async (entity) => {
    const failure = new Error('database unavailable')
    const lookup = entity === 'topic' ? vi.spyOn(topicService, 'getById') : vi.spyOn(assistantDataService, 'getById')
    lookup.mockImplementation(() => {
      throw failure
    })

    await expect(
      service.callTopicTool(topicId, assistantId, 'list_tabs', {}, new AbortController().signal)
    ).rejects.toBe(failure)
    if (entity === 'topic') {
      expect(() => service.topicBrowser.get({ sessionId: topicId, ownerId: assistantId })).toThrow(failure)
      await expect(
        service.topicBrowser.ensureGuest({ sessionId: topicId, ownerId: assistantId }, new AbortController().signal)
      ).rejects.toBe(failure)
    }
  })

  it('waits for idle server cleanup before handling concurrent new calls', async () => {
    const { fixture, tabId } = attachTopicGuest()
    const call = () => service.callTopicTool(topicId, assistantId, 'list_tabs', {}, new AbortController().signal)
    await call()
    const started = new Signal<void>()
    const resume = new Signal<void>()
    const dispose = SessionBrowserController.prototype.dispose
    vi.spyOn(SessionBrowserController.prototype, 'dispose').mockImplementationOnce(
      async function (this: SessionBrowserController) {
        started.resolve()
        await resume
        await dispose.call(this)
      }
    )

    vi.advanceTimersByTime(5 * 60_000)
    await started
    const calls = Promise.allSettled([call(), call()])
    resume.resolve()
    const results = await calls

    for (const result of results) {
      expect(result.status).toBe('fulfilled')
      if (result.status === 'fulfilled') {
        expect(result.value.isError).toBe(false)
        expect(JSON.stringify(result.value)).toContain(tabId)
      }
    }
    expect(fixture.guest.isDestroyed()).toBe(false)
    await expect(call()).resolves.toMatchObject({ isError: false })
  })

  it('aborts a tool waiting for its guest without waiting for the ensure timeout', async () => {
    const abort = new AbortController()
    const pending = service.callTopicTool(topicId, assistantId, 'snapshot', {}, abort.signal)
    await vi.waitFor(() =>
      expect(application.get('IpcApiService').broadcast).toHaveBeenCalledWith(
        'browser.guest.ensure_requested',
        expect.objectContaining({ scope: 'topic', sessionId: topicId })
      )
    )
    abort.abort(new Error('cancelled by user'))
    const next = service.callTopicTool(topicId, assistantId, 'list_tabs', {}, new AbortController().signal)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('cancelled by user')
    await expect(next).resolves.toMatchObject({ isError: false })
    await expect(
      service.callTopicTool(secondTopic, assistantId, 'list_tabs', {}, new AbortController().signal)
    ).resolves.toMatchObject({ isError: false })
  })
})
