import type { Assistant, Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { buildPlugins } from '../PluginBuilder'

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

vi.mock('@renderer/hooks/useSettings', () => ({
  getEnableDeveloperMode: vi.fn(() => false)
}))

vi.mock('@renderer/config/models', () => ({
  isGemini3Model: vi.fn(() => false),
  isQwen35Model: vi.fn(() => false),
  isSupportedThinkingTokenQwenModel: vi.fn(() => false)
}))

vi.mock('@renderer/utils/provider', () => ({
  isOllamaProvider: vi.fn(() => false),
  isSupportEnableThinkingProvider: vi.fn(() => false)
}))

vi.mock('@cherrystudio/ai-core/built-in/plugins', () => ({
  createPromptToolUsePlugin: vi.fn(() => ({ name: 'promptToolUse' })),
  webSearchPlugin: vi.fn(() => ({ name: 'webSearch' }))
}))

vi.mock('../anthropicCachePlugin', () => ({
  createAnthropicCachePlugin: vi.fn(() => ({ name: 'anthropicCache' }))
}))

vi.mock('../noThinkPlugin', () => ({
  createNoThinkPlugin: vi.fn(() => ({ name: 'noThink' }))
}))

vi.mock('../openrouterGenerateImagePlugin', () => ({
  createOpenrouterGenerateImagePlugin: vi.fn(() => ({ name: 'openrouterGenerateImage' }))
}))

vi.mock('../openrouterReasoningPlugin', () => ({
  createOpenrouterReasoningPlugin: vi.fn(() => ({ name: 'openrouterReasoning' }))
}))

vi.mock('../qwenThinkingPlugin', () => ({
  createQwenThinkingPlugin: vi.fn(() => ({ name: 'qwenThinking' }))
}))

vi.mock('../reasoningExtractionPlugin', () => ({
  createReasoningExtractionPlugin: vi.fn(() => ({ name: 'reasoningExtraction' }))
}))

vi.mock('../searchOrchestrationPlugin', () => ({
  searchOrchestrationPlugin: vi.fn(() => ({ name: 'searchOrchestration' }))
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

vi.mock('../../utils/reasoning', () => ({
  getReasoningTagName: vi.fn(() => 'think')
}))

function createAssistant(): Assistant {
  return {
    id: 'assistant-1',
    name: 'Test Assistant',
    prompt: '',
    topics: [],
    type: 'assistant',
    settings: {}
  }
}

function createModel(provider = SystemProviderIds.openrouter): Model {
  return {
    id: 'google/gemini-2.5-flash-image-preview',
    name: 'Gemini 2.5 Flash Image',
    provider
  } as Model
}

function createProvider(id = SystemProviderIds.openrouter): Provider {
  return {
    id,
    name: 'Test Provider',
    type: id === SystemProviderIds.openrouter ? 'openai' : 'google'
  } as Provider
}

describe('PluginBuilder', () => {
  it('mounts openrouterGenerateImage plugin when provider is openrouter and generate image is enabled', () => {
    const plugins = buildPlugins({
      provider: createProvider(),
      model: createModel(),
      config: {
        assistant: createAssistant(),
        streamOutput: true,
        enableReasoning: false,
        isPromptToolUse: false,
        isSupportedToolUse: false,
        isImageGenerationEndpoint: false,
        enableWebSearch: false,
        enableGenerateImage: true,
        enableUrlContext: false
      }
    })

    expect(plugins.map((plugin) => plugin.name)).toContain('openrouterGenerateImage')
  })

  it('does not mount openrouterGenerateImage plugin when generate image is disabled', () => {
    const plugins = buildPlugins({
      provider: createProvider(),
      model: createModel(),
      config: {
        assistant: createAssistant(),
        streamOutput: true,
        enableReasoning: false,
        isPromptToolUse: false,
        isSupportedToolUse: false,
        isImageGenerationEndpoint: false,
        enableWebSearch: false,
        enableGenerateImage: false,
        enableUrlContext: false
      }
    })

    expect(plugins.map((plugin) => plugin.name)).not.toContain('openrouterGenerateImage')
  })

  it('does not mount openrouterGenerateImage plugin for non-openrouter providers', () => {
    const plugins = buildPlugins({
      provider: createProvider(SystemProviderIds.gemini),
      model: createModel(SystemProviderIds.gemini),
      config: {
        assistant: createAssistant(),
        streamOutput: true,
        enableReasoning: false,
        isPromptToolUse: false,
        isSupportedToolUse: false,
        isImageGenerationEndpoint: false,
        enableWebSearch: false,
        enableGenerateImage: true,
        enableUrlContext: false
      }
    })

    expect(plugins.map((plugin) => plugin.name)).not.toContain('openrouterGenerateImage')
  })
})
