import { describe, expect, it } from 'vitest'

import { parseCliUsageOutput } from '../SubscriptionQuotaService'

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
})
