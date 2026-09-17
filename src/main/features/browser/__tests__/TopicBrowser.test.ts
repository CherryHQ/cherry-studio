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
import type { WindowId } from '@shared/ipc/types'
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

  function attachTopicGuest() {
    const host = { getZoomFactor: () => 1 } as Electron.WebContents
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: host,
      on: vi.fn(),
      removeListener: vi.fn(),
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => false
    } as unknown as Electron.BrowserWindow)
    const fixture = createGuest(71)
    Object.assign(fixture.mock, {
      getType: () => 'webview',
      getZoomFactor: () => 1,
      hostWebContents: host,
      session: session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    })
    vi.mocked(webContents.fromId).mockReturnValue(fixture.guest)
    const { tabId } = service.topicBrowser.attach(topicId, 71, windowId)
    return { fixture, tabId }
  }

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
