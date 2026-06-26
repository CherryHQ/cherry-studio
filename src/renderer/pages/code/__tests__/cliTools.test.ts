import { CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CLI_TOOLS, generateProviderConfig, type ToolEnvironmentConfig } from '../cliTools'

vi.mock('@renderer/utils/api', () => ({
  formatApiHost: vi.fn((host) => {
    if (!host) return ''
    const normalized = host.replace(/\/$/, '').trim()
    if (normalized.endsWith('#')) {
      return normalized.replace(/#$/, '')
    }
    if (/\/v\d+(?:alpha|beta)?(?=\/|$)/i.test(normalized)) {
      return normalized
    }
    return `${normalized}/v1`
  })
}))

describe('generateProviderConfig', () => {
  const baseConfig = (
    overrides: Partial<ToolEnvironmentConfig> & Pick<ToolEnvironmentConfig, 'tool' | 'baseUrl'>
  ): ToolEnvironmentConfig => ({
    rawModelId: 'test-model',
    modelName: 'test-model',
    providerId: 'dashscope',
    fancyProviderName: 'DashScope',
    isAnthropic: false,
    apiKey: 'test-key',
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should format baseUrl with /v1 for claudeCode when missing', () => {
    const config = generateProviderConfig(
      baseConfig({ tool: codeCLI.claudeCode, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode' })
    )

    expect(config.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should not duplicate /v1 when already present for claudeCode', () => {
    const config = generateProviderConfig(
      baseConfig({ tool: codeCLI.claudeCode, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
    )

    expect(config.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle empty baseUrl gracefully', () => {
    const config = generateProviderConfig(baseConfig({ tool: codeCLI.claudeCode, baseUrl: '' }))

    expect(config.baseUrl).toBe('')
  })

  it('should preserve other API versions when present', () => {
    const config = generateProviderConfig(
      baseConfig({ tool: codeCLI.claudeCode, baseUrl: 'https://dashscope.aliyuncs.com/v2' })
    )

    expect(config.baseUrl).toBe('https://dashscope.aliyuncs.com/v2')
  })

  it('should format baseUrl with /v1 for openaiCodex when missing', () => {
    const config = generateProviderConfig(
      baseConfig({ tool: codeCLI.openaiCodex, providerId: 'openai', baseUrl: 'https://api.openai.com' })
    )

    expect(config.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('should handle trailing slash correctly', () => {
    const config = generateProviderConfig(
      baseConfig({ tool: codeCLI.claudeCode, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/' })
    )

    expect(config.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle v2beta version correctly', () => {
    const config = generateProviderConfig(
      baseConfig({ tool: codeCLI.claudeCode, baseUrl: 'https://dashscope.aliyuncs.com/v2beta' })
    )

    expect(config.baseUrl).toBe('https://dashscope.aliyuncs.com/v2beta')
  })
})

describe('CLI_TOOLS', () => {
  it('exposes every CodeCli enum value with a renderable icon component', () => {
    const expectedValues = Object.values(CodeCli)
    const actualValues = CLI_TOOLS.map((tool) => tool.value)

    expect(actualValues.sort()).toEqual([...expectedValues].sort())

    for (const tool of CLI_TOOLS) {
      expect(typeof tool.icon).toBe('function')
    }
  })
})
