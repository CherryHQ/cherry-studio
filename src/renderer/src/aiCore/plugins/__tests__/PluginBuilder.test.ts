import type { Model, Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateReasoningExtractionPlugin, mockCreatePdfCompatibilityPlugin } = vi.hoisted(() => ({
  mockCreateReasoningExtractionPlugin: vi.fn((options: { tagName?: string } = {}) => ({
    name: 'reasoningExtraction',
    options
  })),
  mockCreatePdfCompatibilityPlugin: vi.fn(() => ({
    name: 'pdfCompatibility'
  }))
}))

vi.mock('@renderer/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/hooks/useSettings')>()
  return {
    ...actual,
    getEnableDeveloperMode: vi.fn(() => false)
  }
})

vi.mock('@renderer/config/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/config/models')>()
  return {
    ...actual,
    isDeepSeekModel: vi.fn(() => false),
    isGemini3Model: vi.fn(() => false),
    isReasoningModel: vi.fn((model: Model) => model.id.includes('glm-4.7') || model.id.includes('gpt-oss')),
    isQwen35to39Model: vi.fn(() => false),
    isSupportedThinkingTokenQwenModel: vi.fn(() => false)
  }
})

vi.mock('@renderer/utils/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/utils/provider')>()
  return {
    ...actual,
    isOllamaProvider: vi.fn((provider: Provider) => provider.id === 'ollama' || provider.type === 'ollama'),
    isSupportEnableThinkingProvider: vi.fn(() => false)
  }
})

vi.mock('../reasoningExtractionPlugin', () => ({
  createReasoningExtractionPlugin: mockCreateReasoningExtractionPlugin
}))

vi.mock('../pdfCompatibilityPlugin', () => ({
  createPdfCompatibilityPlugin: mockCreatePdfCompatibilityPlugin
}))

vi.mock('../anthropicCachePlugin', () => ({
  createAnthropicCachePlugin: vi.fn(() => ({ name: 'anthropicCache' }))
}))

vi.mock('../deepseekDsmlParserPlugin', () => ({
  createDeepseekDsmlParserPlugin: vi.fn(() => ({ name: 'deepseekDsmlParser' }))
}))

vi.mock('../noThinkPlugin', () => ({
  createNoThinkPlugin: vi.fn(() => ({ name: 'noThink' }))
}))

vi.mock('../openrouterReasoningPlugin', () => ({
  createOpenrouterReasoningPlugin: vi.fn(() => ({ name: 'openrouterReasoning' }))
}))

vi.mock('../qwenThinkingPlugin', () => ({
  createQwenThinkingPlugin: vi.fn(() => ({ name: 'qwenThinking' }))
}))

vi.mock('../simulateStreamingPlugin', () => ({
  createSimulateStreamingPlugin: vi.fn(() => ({ name: 'simulateStreaming' }))
}))

vi.mock('../skipGeminiThoughtSignaturePlugin', () => ({
  createSkipGeminiThoughtSignaturePlugin: vi.fn(() => ({ name: 'skipGeminiThoughtSignature' }))
}))

vi.mock('../telemetryPlugin', () => ({
  createTelemetryPlugin: vi.fn(() => ({ name: 'telemetry' }))
}))

vi.mock('@cherrystudio/ai-core/built-in/plugins', () => ({
  createPromptToolUsePlugin: vi.fn(() => ({ name: 'promptToolUse' })),
  providerToolPlugin: vi.fn(() => ({ name: 'providerTool' }))
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

import { buildPlugins } from '../PluginBuilder'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'ollama',
    name: 'Ollama',
    type: 'ollama',
    apiKey: '',
    apiHost: 'http://localhost:11434',
    isSystem: false,
    models: [],
    extra_headers: {},
    ...overrides
  } as Provider
}

function makeModel(id: string): Model {
  return {
    id,
    name: id,
    provider: 'ollama'
  } as Model
}

function makeConfig() {
  return {
    assistant: {} as never,
    streamOutput: true,
    enableReasoning: false,
    enableGenerateImage: false,
    enableWebSearch: false,
    enableUrlContext: false,
    isSupportedToolUse: false,
    isPromptToolUse: false,
    mcpTools: []
  }
}

describe('PluginBuilder reasoning extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enables reasoning extraction for Ollama thinking models', () => {
    const plugins = buildPlugins({
      provider: makeProvider(),
      model: makeModel('glm-4.7-flash:q4_K_M'),
      config: makeConfig()
    })

    expect(plugins.map((plugin) => plugin.name)).toContain('reasoningExtraction')
    expect(mockCreateReasoningExtractionPlugin).toHaveBeenCalledWith({ tagName: 'think' })
  })

  it('does not enable reasoning extraction for non-thinking Ollama models', () => {
    const plugins = buildPlugins({
      provider: makeProvider(),
      model: makeModel('llama3.1'),
      config: makeConfig()
    })

    expect(plugins.map((plugin) => plugin.name)).not.toContain('reasoningExtraction')
  })
})
