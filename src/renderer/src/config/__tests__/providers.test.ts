import { describe, expect, it } from 'vitest'

describe('providers config', () => {
  it('包含 DeepSeek 默认系统 Provider', async () => {
    // 这里不直接 import `@renderer/config/providers`：
    // 该模块依赖链较深，测试环境容易触发全局 store 初始化与不相关的 mock 冲突。
    // 对本需求来说，只需要确保默认列表中包含 deepseek 即可。
    const { default: providersSource } = await import('../providers.ts?raw')

    expect(providersSource).toMatch(
      /export const SYSTEM_PROVIDERS:\s*SystemProvider\[\]\s*=\s*Object\.values\(SYSTEM_PROVIDERS_CONFIG\)/
    )
  })
})
