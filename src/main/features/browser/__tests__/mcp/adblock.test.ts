import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdblockService } = vi.hoisted(() => ({ getAdblockService: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  const get = module.application.get
  module.application.get = vi.fn((name) => (name === 'AdblockService' ? getAdblockService() : get(name)))
  return module
})

import type { BrowserController } from '@main/features/browser/mcp/browserController'
import { handleBlockAds } from '@main/features/browser/mcp/tools/adblock'

function controllerFor(url: string): BrowserController {
  return {
    getSession: async () => ({ tabId: 'tab-1', session: { guest: { getURL: () => url } } })
  } as unknown as BrowserController
}

const controller = controllerFor('https://www.example.com/page')

function textOf(result: Awaited<ReturnType<typeof handleBlockAds>>): string {
  const part = result.content[0]
  if (part?.type !== 'text') throw new Error('expected a text result')
  return part.text
}

describe('block_ads tool', () => {
  const addCustomRule = vi.fn()

  beforeEach(() => {
    addCustomRule.mockReset()
    getAdblockService.mockReturnValue({ addCustomRule, isAiRuleWritingEnabled: () => true, isActive: () => true })
  })

  it('saves a cosmetic rule for the given domain', async () => {
    addCustomRule.mockResolvedValue({
      existing: false,
      rule: {
        id: 'rule-1',
        domain: 'www.example.com',
        kind: 'cosmetic',
        value: '.sponsored-card',
        note: '搜索页推广',
        source: 'ai',
        enabled: true,
        createdAt: 1
      }
    })

    const result = await handleBlockAds(controller, {
      domain: 'www.example.com',
      css: '.sponsored-card',
      note: '搜索页推广'
    })

    expect(addCustomRule).toHaveBeenCalledWith({
      domain: 'www.example.com',
      kind: 'cosmetic',
      value: '.sponsored-card',
      note: '搜索页推广',
      source: 'ai'
    })
    expect(result.isError).toBe(false)
    expect(JSON.parse(textOf(result))).toEqual({
      id: 'rule-1',
      domain: 'www.example.com',
      kind: 'cosmetic',
      value: '.sponsored-card',
      applied: true,
      status: 'completed',
      updated: false
    })
  })

  it('reports a saved rule as deferred while ad blocking is off', async () => {
    getAdblockService.mockReturnValue({ addCustomRule, isAiRuleWritingEnabled: () => true, isActive: () => false })
    addCustomRule.mockResolvedValue({
      existing: false,
      rule: {
        id: 'rule-4',
        domain: 'example.com',
        kind: 'cosmetic',
        value: '.ad',
        note: '',
        source: 'ai',
        enabled: true,
        createdAt: 1
      }
    })

    const result = await handleBlockAds(controller, { domain: 'example.com', css: '.ad' })

    expect(result.isError).toBe(false)
    expect(JSON.parse(textOf(result))).toMatchObject({
      applied: false,
      status: 'deferred',
      message: expect.stringContaining('ad blocking is off')
    })
  })

  it('saves a network rule when urlFilter is used', async () => {
    addCustomRule.mockResolvedValue({
      existing: true,
      rule: {
        id: 'rule-2',
        domain: 'example.com',
        kind: 'network',
        value: '||ads.example.com^',
        note: '',
        source: 'ai',
        enabled: true,
        createdAt: 1
      }
    })

    const result = await handleBlockAds(controller, {
      domain: 'example.com',
      urlFilter: '||ads.example.com^'
    })

    expect(addCustomRule).toHaveBeenCalledWith({
      domain: 'example.com',
      kind: 'network',
      value: '||ads.example.com^',
      note: undefined,
      source: 'ai'
    })
    expect(JSON.parse(textOf(result)).updated).toBe(true)
  })

  it('rejects arguments without css or urlFilter', async () => {
    const result = await handleBlockAds(controller, { domain: 'example.com' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('css or urlFilter')
    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('refuses to add rules when the user turned automatic rules off', async () => {
    getAdblockService.mockReturnValue({ addCustomRule, isAiRuleWritingEnabled: () => false })

    const result = await handleBlockAds(controller, { domain: 'example.com', css: '.ad' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('turned off')
    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('reports a validation error from the service', async () => {
    addCustomRule.mockRejectedValue(new Error('CSS selector contains disallowed characters'))

    const result = await handleBlockAds(controller, { domain: 'example.com', css: '.ad{display:none}' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CSS selector')
  })

  it('refuses a domain that does not cover the page the controller is showing', async () => {
    const result = await handleBlockAds(controller, { domain: 'other.com', css: '.ad' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('not the current page')
    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('refuses a public suffix as the rule scope', async () => {
    const result = await handleBlockAds(controllerFor('https://merchant.co.uk/page'), {
      domain: 'co.uk',
      css: '.promo'
    })

    expect(result.isError).toBe(true)
    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('refuses to scope a rule when the tab has no http(s) page', async () => {
    const result = await handleBlockAds(controllerFor('about:blank'), { domain: 'example.com', css: '.ad' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('no http(s) page')
    expect(addCustomRule).not.toHaveBeenCalled()
  })

  it('forwards a private or non-active tab instead of the active normal tab', async () => {
    const getSession = vi.fn(async () => ({
      tabId: 'private-tab',
      session: { guest: { getURL: () => 'https://private.example.net/page' } }
    }))
    addCustomRule.mockResolvedValue({
      existing: false,
      rule: {
        id: 'rule-3',
        domain: 'private.example.net',
        kind: 'cosmetic',
        value: '.ad',
        note: '',
        source: 'ai',
        enabled: true,
        createdAt: 1
      }
    })

    const result = await handleBlockAds({ getSession } as unknown as BrowserController, {
      domain: 'private.example.net',
      css: '.ad',
      privateMode: true,
      tabId: 'private-tab'
    })

    expect(getSession).toHaveBeenCalledWith(true, 'private-tab')
    expect(result.isError).toBe(false)
    expect(addCustomRule).toHaveBeenCalledWith({
      domain: 'private.example.net',
      kind: 'cosmetic',
      value: '.ad',
      note: undefined,
      source: 'ai'
    })
  })

  it('still rejects a public suffix on the observed private tab', async () => {
    const getSession = vi.fn(async () => ({
      tabId: 'private-tab',
      session: { guest: { getURL: () => 'https://merchant.co.uk/page' } }
    }))

    const result = await handleBlockAds({ getSession } as unknown as BrowserController, {
      domain: 'co.uk',
      css: '.promo',
      privateMode: true,
      tabId: 'private-tab'
    })

    expect(getSession).toHaveBeenCalledWith(true, 'private-tab')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Invalid domain')
    expect(addCustomRule).not.toHaveBeenCalled()
  })
})
