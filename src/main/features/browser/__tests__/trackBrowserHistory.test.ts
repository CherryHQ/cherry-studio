import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

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
})
