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

const controller = {} as BrowserController

function textOf(result: Awaited<ReturnType<typeof handleBlockAds>>): string {
  const part = result.content[0]
  if (part?.type !== 'text') throw new Error('expected a text result')
  return part.text
}

describe('block_ads tool', () => {
  const addCustomRule = vi.fn()

  beforeEach(() => {
    addCustomRule.mockReset()
    getAdblockService.mockReturnValue({ addCustomRule, isAiRuleWritingEnabled: () => true })
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
      updated: false
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
    addCustomRule.mockRejectedValue(new Error('CSS 选择器包含不允许的字符'))

    const result = await handleBlockAds(controller, { domain: 'example.com', css: '.ad{display:none}' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CSS 选择器')
  })
})
