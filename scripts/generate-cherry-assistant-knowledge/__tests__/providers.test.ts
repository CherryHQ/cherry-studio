import { describe, expect, it } from 'vitest'

import { generateProvidersFragment } from '../generators/providers'

describe('generateProvidersFragment', () => {
  it('reports a non-zero provider count matching SystemProviderIds', () => {
    const { count } = generateProvidersFragment('zh-CN')
    expect(count).toBeGreaterThan(0)
  })

  it('produces a zh-CN summary with all category labels and trailing note', () => {
    const { summary } = generateProvidersFragment('zh-CN')
    expect(summary).toContain('国际:')
    expect(summary).toContain('聚合:')
    expect(summary).toContain('国内:')
    expect(summary).toContain('本地:')
    expect(summary).toContain('加速:')
    expect(summary).toContain('支持任何 OpenAI 兼容端点')
  })

  it('produces an en-US summary with English category labels and trailing note', () => {
    const { summary } = generateProvidersFragment('en-US')
    expect(summary).toContain('International:')
    expect(summary).toContain('Aggregator:')
    expect(summary).toContain('China:')
    expect(summary).toContain('Local:')
    expect(summary).toContain('Accelerator:')
    expect(summary).toContain('Any OpenAI-compatible endpoint is supported')
  })

  it('keeps the count consistent between zh-CN and en-US', () => {
    const zh = generateProvidersFragment('zh-CN')
    const en = generateProvidersFragment('en-US')
    expect(zh.count).toBe(en.count)
  })

  it('has every SystemProviderIds entry categorized (no unknowns)', () => {
    const { unknown } = generateProvidersFragment('zh-CN')
    expect(unknown).toEqual([])
  })
})
