import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { mockPreferenceService, mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { AgentBrowserRuntimeService } from '../AgentBrowserRuntimeService'

// These cases protect retained page state and selection from unrelated open/navigation requests.
describe('conversation browser pages', () => {
  const runtime = new AgentBrowserRuntimeService('topic')
  beforeEach(() => {
    mockPreferenceService._resetMockState()
    MockCacheUtils.setInitialState({ persist: [] })
    runtime.declare('one', 'app-one')
    runtime.declare('two', 'app-two')
  })
  afterEach(() => runtime.dispose())

  it.each(['agent', 'topic'] as const)('uses the configured start page only for manual %s page creation', (scope) => {
    const browser = new AgentBrowserRuntimeService(scope)
    browser.declare('conversation', 'app-tab')
    mockPreferenceState.set('app.browser.start_page.mode', 'custom')
    mockPreferenceState.set('app.browser.start_page.custom_url', 'HTTPS://Home.test:443/start')
    try {
      const home = browser.openStartPage('conversation')
      expect(browser.get('conversation', home)?.sourceUrl).toBe('https://home.test/start')
      browser.openPage('conversation', 'https://explicit.test/')
      expect(browser.get('conversation')?.sourceUrl).toBe('https://explicit.test/')
      browser.openPage('conversation', 'about:blank')
      expect(browser.get('conversation')?.sourceUrl).toBe('about:blank')
      expect(browser.get('conversation', home)?.sourceUrl).toBe('https://home.test/start')
    } finally {
      browser.dispose()
    }
  })

  it('remembers only the selected ordinary page in last-page mode and keeps conversation scopes separate', () => {
    mockPreferenceState.set('app.browser.start_page.mode', 'last')
    MockCacheUtils.setInitialState({
      persist: [['ui.browser.last_urls', { 'topic:one': 'https://topic.test/', 'agent:one': 'https://agent.test/' }]]
    })
    const first = runtime.openStartPage('one')!
    expect(runtime.get('one')?.sourceUrl).toBe('https://topic.test/')
    const background = runtime.openPage('one', 'https://background.test/', undefined, { activate: false })!
    runtime.update('one', { url: 'https://background.test/changed' }, background)
    expect(cacheService.getPersist('ui.browser.last_urls')['topic:one']).toBe('https://topic.test/')
    runtime.update('one', { url: 'https://topic.test/path?token=secret&lang=en#section', ready: true }, first)
    expect(cacheService.getPersist('ui.browser.last_urls')).toEqual({
      'topic:one': 'https://topic.test/path?lang=en#section',
      'agent:one': 'https://agent.test/'
    })
    runtime.update('one', { url: 'file:///workspace/index.html' }, first)
    expect(cacheService.getPersist('ui.browser.last_urls')['topic:one']).toBe('https://topic.test/path?lang=en#section')
  })

  it('keeps independent state when switching pages and conversations', () => {
    const first = runtime.openPage('one', 'https://example.com/docs')!
    runtime.update('one', { title: 'Docs', ready: true }, first)
    const second = runtime.openPage('one', 'https://example.com/app')!
    runtime.update('one', { title: 'App', executing: true }, second)
    runtime.activate('one', first)
    runtime.openPage('two', 'https://other.example/')
    expect(runtime.get('one')).toMatchObject({ pageId: first, title: 'Docs', ready: true })
    expect(runtime.get('one', second)).toMatchObject({ title: 'App', executing: true })
    expect(runtime.getPages('two')).toHaveLength(1)
    runtime.activate('one', runtime.get('two')!.pageId)
    expect(runtime.get('one')?.pageId).toBe(first)
  })

  it('reuses a matching link while explicit new-page requests allow duplicates', () => {
    const first = runtime.openPage('one', 'https://example.com/')
    runtime.openPage('one', 'https://other.example/')
    expect(runtime.openPage('one', 'https://example.com/')).toBe(first)
    expect(runtime.getPages('one')).toHaveLength(2)
    runtime.openPage('one', 'https://example.com/', undefined, { reuse: false })
    expect(runtime.getPages('one')).toHaveLength(3)
  })

  it('updates an identified preview without replacing or selecting the document', () => {
    const document = runtime.openPage('one', 'https://example.com/docs')
    const preview = runtime.openPage('one', 'http://localhost:5173/', WebviewSecurityProfile.AgentDevPreview, {
      previewKey: 'server',
      activate: false
    })
    runtime.openPage('one', 'http://localhost:5173/login', WebviewSecurityProfile.AgentDevPreview, {
      previewKey: 'server',
      activate: false
    })
    expect(runtime.get('one')?.pageId).toBe(document)
    expect(runtime.getPages('one')).toHaveLength(2)
    expect(runtime.get('one', preview)).toMatchObject({
      sourceUrl: 'http://localhost:5173/login',
      securityProfile: WebviewSecurityProfile.AgentDevPreview
    })
  })

  it('changes authorization only for the navigated page', () => {
    const first = runtime.openPage('one', 'https://example.com/')!
    const second = runtime.openPage('one', 'https://example.com/docs')!
    runtime.navigate('one', first, 'file:///workspace/index.html')
    expect(runtime.get('one', first)?.securityProfile).toBe(WebviewSecurityProfile.AgentHtmlArtifact)
    expect(runtime.get('one', second)?.securityProfile).toBe(WebviewSecurityProfile.AgentBrowser)
    runtime.navigate('one', first, 'https://example.org/')
    expect(runtime.get('one', first)?.securityProfile).toBe(WebviewSecurityProfile.AgentBrowser)
  })

  it('closes a batch while preserving surviving state and choosing the nearest right neighbor', () => {
    const first = runtime.openPage('one', 'https://example.com/first')!
    const selected = runtime.openPage('one', 'https://example.com/selected')!
    const right = runtime.openPage('one', 'https://example.com/right')!
    const last = runtime.openPage('one', 'https://example.com/last')!
    runtime.update('one', { executing: true, ready: true, title: 'Retained' }, right)
    const retained = runtime.get('one', right)
    const other = runtime.openPage('two', 'https://other.test/')!
    runtime.activate('one', selected)
    runtime.closePages('one', [first, selected, last, other])
    expect(runtime.get('one')).toBe(retained)
    expect(runtime.get('one')).toMatchObject({ pageId: right, executing: true, ready: true, title: 'Retained' })
    expect(runtime.get('two')?.pageId).toBe(other)
    runtime.closePages('one', [right])
    expect(runtime.hasSession('one')).toBe(true)
    expect(runtime.get('one')).toBeUndefined()
    expect(runtime.getPages('one')).toEqual([])
  })

  it('chooses adjacent pages on close and keeps the last-page empty state until an explicit open', () => {
    const first = runtime.openPage('one')!
    const second = runtime.openPage('one')!
    const third = runtime.openPage('one')!
    runtime.activate('one', second)
    runtime.closePage('one', second)
    expect(runtime.get('one')?.pageId).toBe(third)
    runtime.closePage('one', third)
    expect(runtime.get('one')?.pageId).toBe(first)
    runtime.closePage('one', first)
    runtime.ensure('one')
    expect(runtime.getPages('one')).toEqual([])
    runtime.navigate('one', first, 'https://example.com/')
    expect(runtime.getPages('one')).toEqual([])
    expect(runtime.openPage('one')).toBeDefined()
  })

  it('releases every page only after the last application tab relinquishes the conversation', () => {
    runtime.openPage('one')
    runtime.openPage('one')
    runtime.syncOwners(new Map([['app-two', 'one']]))
    expect(runtime.getPages('one')).toHaveLength(2)
    runtime.syncOwners(new Map())
    expect(runtime.getPages('one')).toEqual([])
    expect(runtime.openPage('one')).toBeUndefined()
  })
})
