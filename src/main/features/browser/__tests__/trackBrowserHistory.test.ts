import { EventEmitter } from 'node:events'

import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { BaseService } from '@main/core/lifecycle'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { setupTestDatabase } from '@test-helpers/db'
import { app, session, webContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { BrowserSessionService } from '../BrowserSessionService'
import { trackBrowserHistory } from '../trackBrowserHistory'
import { createGuest } from './guestFixture'

describe('Browser navigation history', () => {
  setupTestDatabase()
  it('records completed main-frame visits once, updates late titles, and excludes failed loads and subframes', () => {
    const { guest, mock } = createGuest()
    Object.assign(mock, { isLoadingMainFrame: () => true })
    const release = trackBrowserHistory(guest)
    const visits = () => browserHistoryService.list({ offset: 0, limit: 25 }).items
    mock.emit('did-navigate', {}, 'https://example.com')
    mock.emit('did-finish-load')
    mock.emit('did-finish-load')
    mock.emit('did-navigate-in-page', {}, 'https://frame.test', false)
    expect(visits()).toHaveLength(1)
    mock.getTitle.mockReturnValue('Late title')
    mock.emit('page-title-updated')
    expect(visits()[0].title).toBe('Late title')
    mock.getURL.mockReturnValue('https://example.com/failed')
    mock.emit('did-navigate')
    mock.emit('did-fail-load', {}, -2, 'failed', guest.getURL(), true)
    mock.emit('did-finish-load')
    expect(visits()).toHaveLength(1)
    mock.getURL.mockReturnValue('https://example.com/#next')
    mock.emit('did-navigate-in-page', {}, guest.getURL(), true)
    expect(visits()).toHaveLength(2)
    release()
    mock.emit('did-navigate-in-page', {}, guest.getURL(), true)
    expect(visits()).toHaveLength(2)
    Object.assign(mock, { isLoadingMainFrame: () => false })
    const resumed = trackBrowserHistory(guest, false)
    expect(visits()).toHaveLength(2)
    mock.emit('did-navigate-in-page', {}, guest.getURL(), true)
    expect(visits()).toHaveLength(3)
    resumed()
    expect(mock.isDestroyed()).toBe(false)
  })
  it('tracks ordinary browser tabs without Agent bindings and releases tracking on destruction and service stop', async () => {
    const ordinary = createGuest(30)
    const preview = createGuest(31)
    const hidden = createGuest(32)
    for (const fixture of [ordinary, preview, hidden]) {
      Object.assign(fixture.mock, {
        getType: () => (fixture === hidden ? 'browserView' : 'webview'),
        isLoadingMainFrame: () => true,
        session: session.fromPartition(
          getWebviewPartition(
            fixture === preview ? WebviewSecurityProfile.AgentDevPreview : WebviewSecurityProfile.AgentBrowser
          )
        )
      })
    }
    vi.mocked(webContents.getAllWebContents).mockReturnValueOnce([ordinary.guest, preview.guest, hidden.guest])
    BaseService.resetInstances()
    const events = new EventEmitter()
    const listen = vi.spyOn(app, 'on').mockImplementation((event, listener) => {
      events.on(event, listener)
      return app
    })
    const unlisten = vi.spyOn(app, 'removeListener').mockImplementation((event, listener) => {
      events.removeListener(event, listener)
      return app
    })
    const service = new BrowserSessionService()
    await service._doInit()
    try {
      for (const fixture of [ordinary, preview, hidden]) fixture.mock.emit('did-finish-load')
      const visits = () => browserHistoryService.list({ offset: 0, limit: 25 }).items
      expect(visits()).toHaveLength(1)
      events.emit('web-contents-created', {}, ordinary.guest)
      ordinary.mock.getURL.mockReturnValue('https://example.com/next')
      ordinary.mock.emit('did-navigate-in-page', {}, ordinary.guest.getURL(), true)
      expect(visits()).toHaveLength(2)
      ordinary.mock.close()
      expect(ordinary.mock.listenerCount('did-finish-load')).toBe(0)
      const next = createGuest(33)
      Object.assign(next.mock, {
        getType: () => 'webview',
        isLoadingMainFrame: () => true,
        session: ordinary.guest.session
      })
      events.emit('web-contents-created', {}, next.guest)
      next.mock.emit('did-finish-load')
      expect(visits()).toHaveLength(3)
      let finishRequest!: () => void
      let requestSignal!: AbortSignal
      Object.assign(next.mock.session, {
        fetch: vi.fn((_url: string, options: { signal: AbortSignal }) => {
          requestSignal = options.signal
          return new Promise((_resolve, reject) => {
            finishRequest = () => reject(new Error('Request cancelled'))
          })
        })
      })
      next.mock.emit('page-favicon-updated', {}, ['https://example.com/icon'])
      let stopped = false
      const stopping = service._doStop().then(() => {
        stopped = true
      })
      await Promise.resolve()
      expect(requestSignal.aborted).toBe(true)
      expect(stopped).toBe(false)
      finishRequest()
      await stopping
      next.mock.emit('did-navigate-in-page', {}, next.guest.getURL(), true)
      expect(visits()).toHaveLength(3)
      expect(next.mock.isDestroyed()).toBe(false)
    } finally {
      await service._doStop()
      listen.mockRestore()
      unlisten.mockRestore()
    }
  })
})
