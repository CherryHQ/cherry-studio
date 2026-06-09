import { codeCLI } from '@shared/config/constant'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CLI_TOOL_PROVIDER_MAP, CLI_TOOLS, generateToolEnvironment, type ToolEnvironmentConfig } from '../index'

// Mock CodeCliPage which is default export
vi.mock('../CodeCliPage', () => ({ default: () => null }))

// Mock dependencies needed by CodeCliPage
vi.mock('@renderer/hooks/useCodeCli', () => ({
  useCodeCli: () => ({
    selectedCliTool: codeCLI.qwenCode,
    selectedModel: null,
    selectedTerminal: 'systemDefault',
    environmentVariables: '',
    directories: [],
    currentDirectory: '',
    canLaunch: true,
    setCliTool: vi.fn(),
    setModel: vi.fn(),
    setTerminal: vi.fn(),
    setEnvVars: vi.fn(),
    setCurrentDir: vi.fn(),
    removeDir: vi.fn(),
    selectFolder: vi.fn()
  })
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/store', () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: () => false
}))

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

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

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
      baseConfig({ tool: codeCLI.qwenCode, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should not duplicate /v1 when already present for qwenCode', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: codeCLI.qwenCode, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle empty baseUrl gracefully', () => {
    const { env } = generateToolEnvironment(baseConfig({ tool: codeCLI.qwenCode, baseUrl: '' }))

    expect(env.OPENAI_BASE_URL).toBe('')
  })

  it('should preserve other API versions when present', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: codeCLI.qwenCode, baseUrl: 'https://dashscope.aliyuncs.com/v2' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/v2')
  })

  it('should format baseUrl with /v1 for openaiCodex when missing', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: codeCLI.openaiCodex, providerId: 'openai', baseUrl: 'https://api.openai.com' })
    )

    expect(env.CHERRY_CODEX_BASE_URL).toBe('https://api.openai.com/v1')
  })

  it('should format baseUrl with /v1 for iFlowCli when missing', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: codeCLI.iFlowCli, providerId: 'iflow', baseUrl: 'https://api.iflow.cn' })
    )

    expect(env.IFLOW_BASE_URL).toBe('https://api.iflow.cn/v1')
  })

  it('should handle trailing slash correctly', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: codeCLI.qwenCode, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  it('should handle v2beta version correctly', () => {
    const { env } = generateToolEnvironment(
      baseConfig({ tool: codeCLI.qwenCode, baseUrl: 'https://dashscope.aliyuncs.com/v2beta' })
    )

    expect(env.OPENAI_BASE_URL).toBe('https://dashscope.aliyuncs.com/v2beta')
  })
})

describe('CLI_TOOLS', () => {
  it('exposes every codeCLI enum value with a renderable icon component', () => {
    const expectedValues = Object.values(codeCLI)
    const actualValues = CLI_TOOLS.map((tool) => tool.value)

    expect(actualValues.sort()).toEqual([...expectedValues].sort())

    for (const tool of CLI_TOOLS) {
      expect(typeof tool.icon).toBe('function')
    }
  })
})

describe('CLI_TOOL_PROVIDER_MAP', () => {
  const enabledKey = { id: 'k1', isEnabled: true }

  function makeProvider(overrides: Partial<Provider> & Pick<Provider, 'id'>): Provider {
    return {
      name: overrides.id,
      authType: 'api-key',
      apiKeys: [enabledKey],
      apiFeatures: {},
      settings: {},
      isEnabled: true,
      ...overrides
    } as Provider
  }

  describe('includes compatible providers', () => {
    it('claudeCode includes anthropic provider', () => {
      const filter = CLI_TOOL_PROVIDER_MAP[codeCLI.claudeCode]
      const provider = makeProvider({
        id: 'anthropic',
        presetProviderId: 'anthropic'
      })

      expect(filter([provider])).toHaveLength(1)
    })

    it('claudeCode includes provider with anthropic-messages endpoint', () => {
      const filter = CLI_TOOL_PROVIDER_MAP[codeCLI.claudeCode]
      const provider = makeProvider({
        id: 'custom-provider',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'https://example.com/anthropic' }
        }
      })

      expect(filter([provider])).toHaveLength(1)
    })

    it('qwenCode includes openai-compatible provider', () => {
      const filter = CLI_TOOL_PROVIDER_MAP[codeCLI.qwenCode]
      const provider = makeProvider({
        id: 'test-provider',
        defaultChatEndpoint: 'openai-chat-completions'
      })

      expect(filter([provider])).toHaveLength(1)
    })

    it('openaiCodex includes openai provider', () => {
      const filter = CLI_TOOL_PROVIDER_MAP[codeCLI.openaiCodex]
      const provider = makeProvider({
        id: 'openai',
        defaultChatEndpoint: 'openai-responses'
      })

      expect(filter([provider])).toHaveLength(1)
    })

    it('openCode includes anthropic provider', () => {
      const filter = CLI_TOOL_PROVIDER_MAP[codeCLI.openCode]
      const provider = makeProvider({
        id: 'anthropic',
        presetProviderId: 'anthropic'
      })

      expect(filter([provider])).toHaveLength(1)
    })

    it('geminiCli includes gemini provider', () => {
      const filter = CLI_TOOL_PROVIDER_MAP[codeCLI.geminiCli]
      const provider = makeProvider({
        id: 'gemini',
        defaultChatEndpoint: 'google-generate-content'
      })

      expect(filter([provider])).toHaveLength(1)
    })
  })
})
