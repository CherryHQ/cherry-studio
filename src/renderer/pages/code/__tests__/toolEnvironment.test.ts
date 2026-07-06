import { CodeCli } from '@shared/types/codeCli'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateToolEnvironment, type ToolEnvironmentConfig } from '../toolEnvironment'

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
  }),
  withoutTrailingSlash: vi.fn((host) => (host ? host.replace(/\/+$/, '') : host))
}))

describe('generateToolEnvironment', () => {
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

  it('should format baseUrl with /v1 for qwenCode when missing', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.QWEN_CODE, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should not duplicate /v1 when already present for qwenCode', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.QWEN_CODE, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle empty baseUrl gracefully', () => {
    const { env } = generateToolEnvironment(baseConfig({ tool: CodeCli.QWEN_CODE, baseUrl: '' }))

    expect(env.OPENAI_BASE_URL).toBe('')
  })

  it('should preserve other API versions when present', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.QWEN_CODE, baseUrl: 'https://dashscope.aliyuncs.com/v2' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/v2')
  })

  it('should format baseUrl with /v1 for openaiCodex when missing', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.OPENAI_CODEX, providerId: 'openai', baseUrl: 'https://api.openai.com' })
    )

    expect(env.CHERRY_CODEX_BASE_URL).toBe('https://api.openai.com/v1')
  })

  it('should inject QODERCN_PERSONAL_ACCESS_TOKEN for qoderCli', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.QODER_CLI, providerId: 'qoder', apiKey: 'test-key', baseUrl: 'https://api.qoder.com' })
    )

    expect(env.QODERCN_PERSONAL_ACCESS_TOKEN).toBe('test-key')
  })

  it('should handle trailing slash correctly', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.QWEN_CODE, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle v2beta version correctly', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.QWEN_CODE, baseUrl: 'https://dashscope.aliyuncs.com/v2beta' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/v2beta')
  })

  it('should derive the gemini baseUrl from the configured baseUrl for aihubmix, stripping a trailing /v1', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: CodeCli.GEMINI_CLI, providerId: 'aihubmix', baseUrl: 'https://custom.example.com/v1' })
    )

    // Must follow the configured baseUrl (not the static aihubmix.com host) and drop /v1 before /gemini
    expect(env.GEMINI_BASE_URL).toBe('https://custom.example.com/gemini')
    expect(env.GOOGLE_GEMINI_BASE_URL).toBe('https://custom.example.com/gemini')
  })
})
