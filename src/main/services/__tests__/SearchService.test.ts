import { describe, expect, it, vi } from 'vitest'

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {}
}))

import { isSafeSearchUrl, SEARCH_WINDOW_WEB_PREFERENCES } from '../SearchService'

describe('SearchService security helpers', () => {
  it('only allows http and https URLs in search windows', () => {
    expect(isSafeSearchUrl('https://example.com')).toBe(true)
    expect(isSafeSearchUrl('http://example.com/path?q=1')).toBe(true)
    expect(isSafeSearchUrl('file:///tmp/test.html')).toBe(false)
    expect(isSafeSearchUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeSearchUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('uses isolated and sandboxed search window preferences', () => {
    expect(SEARCH_WINDOW_WEB_PREFERENCES.contextIsolation).toBe(true)
    expect(SEARCH_WINDOW_WEB_PREFERENCES.nodeIntegration).toBe(false)
    expect(SEARCH_WINDOW_WEB_PREFERENCES.sandbox).toBe(true)
    expect(SEARCH_WINDOW_WEB_PREFERENCES.webSecurity).toBe(true)
  })
})
