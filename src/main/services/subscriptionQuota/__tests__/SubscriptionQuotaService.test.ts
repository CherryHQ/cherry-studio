import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseCliUsageOutput, SubscriptionQuotaService } from '../SubscriptionQuotaService'

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: vi.fn().mockReturnValue(null),
    resolveApiKey: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn().mockResolvedValue({})
}))

describe('SubscriptionQuotaService - parseCliUsageOutput', () => {
  it('parses standard 5-hour and 7-day quota output from Claude Code /usage', () => {
    const output = `
      Claude Code Usage
      5-hour limit: 45% used (resets in 2h 15m)
      7-day limit: 20% used (resets on Friday)
      Resets remaining: 3
    `
    const parsed = parseCliUsageOutput(output)
    expect(parsed.fiveHour).toBeDefined()
    expect(parsed.fiveHour?.usedPercentage).toBe(45)
    expect(parsed.fiveHour?.resetsInFormatted).toBe('2h 15m')

    expect(parsed.sevenDay).toBeDefined()
    expect(parsed.sevenDay?.usedPercentage).toBe(20)
    expect(parsed.sevenDay?.resetsInFormatted).toBe('Friday')

    expect(parsed.resets?.remainingCount).toBe(3)
  })

  it('parses Chinese formatted usage output', () => {
    const output = `
      MiniMax 编码套餐状态:
      5小时额度: 60% 已使用 (重置倒计时: 1小时30分后)
      7天用量: 30% 已使用 (重置周期: 周一)
      剩余重置次数: 4次
    `
    const parsed = parseCliUsageOutput(output)
    expect(parsed.fiveHour?.usedPercentage).toBe(60)
    expect(parsed.fiveHour?.resetsInFormatted).toBe('1小时30分后')

    expect(parsed.sevenDay?.usedPercentage).toBe(30)
    expect(parsed.sevenDay?.resetsInFormatted).toBe('周一')

    expect(parsed.resets?.remainingCount).toBe(4)
  })

  it('handles partial output gracefully', () => {
    const output = `
      Current usage:
      5h: 12%
    `
    const parsed = parseCliUsageOutput(output)
    expect(parsed.fiveHour?.usedPercentage).toBe(12)
    expect(parsed.sevenDay).toBeUndefined()
  })

  it('returns empty object when output has no quota metrics', () => {
    const output = `Random output text without any percentages or limits`
    const parsed = parseCliUsageOutput(output)
    expect(parsed.fiveHour).toBeUndefined()
    expect(parsed.sevenDay).toBeUndefined()
    expect(parsed.resets).toBeUndefined()
  })
})

describe('SubscriptionQuotaService - getSubscriptionQuota', () => {
  let service: SubscriptionQuotaService

  beforeEach(() => {
    service = new SubscriptionQuotaService()
    vi.clearAllMocks()
  })

  it('does not execute shell for unknown provider in auto mode without custom command', async () => {
    const result = await service.getSubscriptionQuota({
      providerId: 'unknown-custom-provider',
      method: 'auto'
    })

    expect(result.success).toBe(false)
    expect(result.source).toBe('auto')
    expect(result.fiveHour).toBeUndefined()
    expect(result.sevenDay).toBeUndefined()
    expect(result.error).toMatch(/No default CLI command configured/i)
  })

  it('returns failure when CLI method is requested without configured command', async () => {
    const result = await service.getSubscriptionQuota({
      providerId: 'unsupported-provider',
      method: 'cli'
    })

    expect(result.success).toBe(false)
    expect(result.source).toBe('cli')
    expect(result.fiveHour).toBeUndefined()
    expect(result.error).toBe('No default CLI command configured for this provider')
  })

  it('returns failure when HTTP method is requested without configured url', async () => {
    const result = await service.getSubscriptionQuota({
      providerId: 'openai',
      method: 'http'
    })

    expect(result.success).toBe(false)
    expect(result.source).toBe('http')
    expect(result.fiveHour).toBeUndefined()
    expect(result.error).toBe('No HTTP endpoint configured for quota retrieval')
  })
})
