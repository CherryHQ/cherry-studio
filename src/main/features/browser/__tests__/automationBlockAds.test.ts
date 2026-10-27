import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdblockService } = vi.hoisted(() => ({ getAdblockService: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  const get = module.application.get
  module.application.get = vi.fn((name) => (name === 'AdblockService' ? getAdblockService() : get(name)))
  return module
})

import { executeBrowserOperation } from '@main/features/browser/automation'
import type { BrowserController } from '@main/features/browser/mcp/browserController'

function controllerFor(url: string): BrowserController {
  return {
    getSession: vi.fn(async () => ({
      tabId: 'tab-1',
      session: { guest: { getURL: () => url } }
    }))
  } as unknown as BrowserController
}

const signal = new AbortController().signal

describe('automation blockAds operation', () => {
  const addCustomRule = vi.fn()

  beforeEach(() => {
    addCustomRule.mockReset()
    getAdblockService.mockReturnValue({ addCustomRule, isAiRuleWritingEnabled: () => true, isActive: () => true })
  })

  it('scopes a cosmetic rule to the page the agent is looking at', async () => {
    addCustomRule.mockResolvedValue({
      existing: false,
      rule: {
        id: 'rule-1',
        domain: 'www.example.com',
        kind: 'cosmetic',
        value: '.promo',
        note: 'sticky promo',
        source: 'ai',
        enabled: true,
        createdAt: 1
      }
    })

    const result = await executeBrowserOperation(
      controllerFor('https://www.example.com/article?id=1'),
      'blockAds',
      { css: '.promo', note: 'sticky promo' },
      'tab-1',
      signal
    )

    expect(addCustomRule).toHaveBeenCalledWith({
      domain: 'www.example.com',
      kind: 'cosmetic',
      value: '.promo',
      note: 'sticky promo',
      source: 'ai'
    })
    expect(result.value).toMatchObject({
      tabId: 'tab-1',
      domain: 'www.example.com',
      kind: 'cosmetic',
      applied: true,
      updated: false,
      status: 'completed'
    })
  })

  it('stores a network rule without widening its domain', async () => {
    addCustomRule.mockResolvedValue({
      existing: true,
      rule: {
        id: 'rule-2',
        domain: 'news.example.com',
        kind: 'network',
        value: '||ads.example.net^',
        note: '',
        source: 'ai',
        enabled: true,
        createdAt: 1
      }
    })

    await executeBrowserOperation(
      controllerFor('https://news.example.com/'),
      'blockAds',
      { urlFilter: '||ads.example.net^' },
      'tab-1',
      signal
    )

    expect(addCustomRule).toHaveBeenCalledWith({
      domain: 'news.example.com',
      kind: 'network',
      value: '||ads.example.net^',
      note: undefined,
      source: 'ai'
    })
  })

  it('rejects a model-supplied domain instead of trusting it', async () => {
    await expect(
      executeBrowserOperation(
        controllerFor('https://example.com/'),
        'blockAds',
        { domain: 'other.com', css: '.promo' },
        'tab-1',
        signal
      )
    ).rejects.toThrow()

    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('requires exactly one of css and urlFilter', async () => {
    await expect(
      executeBrowserOperation(controllerFor('https://example.com/'), 'blockAds', {}, 'tab-1', signal)
    ).rejects.toThrow()
    await expect(
      executeBrowserOperation(
        controllerFor('https://example.com/'),
        'blockAds',
        { css: '.promo', urlFilter: '||ads.example.net^' },
        'tab-1',
        signal
      )
    ).rejects.toThrow()

    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('refuses to write when the user turned automatic rules off', async () => {
    getAdblockService.mockReturnValue({ addCustomRule, isAiRuleWritingEnabled: () => false })

    await expect(
      executeBrowserOperation(controllerFor('https://example.com/'), 'blockAds', { css: '.promo' }, 'tab-1', signal)
    ).rejects.toMatchObject({ code: 'ADBLOCK_DISABLED', effect: 'none' })
    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('refuses to save a rule for a non-web page', async () => {
    await expect(
      executeBrowserOperation(controllerFor('file:///tmp/preview.html'), 'blockAds', { css: '.promo' }, 'tab-1', signal)
    ).rejects.toMatchObject({ code: 'ADBLOCK_UNAVAILABLE', effect: 'none' })
    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('reports a saved rule as deferred while ad blocking is off', async () => {
    getAdblockService.mockReturnValue({ addCustomRule, isAiRuleWritingEnabled: () => true, isActive: () => false })
    addCustomRule.mockResolvedValue({
      existing: false,
      rule: {
        id: 'rule-3',
        domain: 'example.com',
        kind: 'cosmetic',
        value: '.promo',
        note: '',
        source: 'ai',
        enabled: true,
        createdAt: 1
      }
    })

    const result = await executeBrowserOperation(
      controllerFor('https://example.com/'),
      'blockAds',
      { css: '.promo' },
      'tab-1',
      signal
    )

    expect(result.value).toMatchObject({ applied: false, status: 'deferred' })
    expect(String((result.value as { message?: string }).message)).toContain('ad blocking is off')
  })
})
