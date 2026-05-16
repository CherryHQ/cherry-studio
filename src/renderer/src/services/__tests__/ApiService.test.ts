import type { Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn()
  }
}))

vi.mock('@renderer/store/mcp', () => ({
  hubMCPServer: { id: 'hub' }
}))

vi.mock('@renderer/aiCore/prepareParams', () => ({
  buildStreamTextParams: vi.fn()
}))

vi.mock('@renderer/aiCore/utils/options', () => ({
  buildProviderOptions: vi.fn()
}))

vi.mock('@renderer/config/models', () => ({
  isDedicatedImageGenerationModel: vi.fn(),
  isEmbeddingModel: vi.fn(),
  isFunctionCallingModel: vi.fn(),
  qwenModel: { id: 'qwen', name: 'Qwen' },
  SYSTEM_MODELS: {}
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn()
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/utils/abortController', () => ({
  abortCompletion: vi.fn(),
  readyToAbort: vi.fn()
}))

vi.mock('@renderer/utils/analytics', () => ({
  trackTokenUsage: vi.fn()
}))

vi.mock('@renderer/utils/assistant', () => ({
  isPromptToolUse: vi.fn(),
  isSupportedToolUse: vi.fn(),
  isToolUseModeFunction: vi.fn()
}))

vi.mock('@renderer/utils/error', () => ({
  getErrorMessage: vi.fn(),
  isAbortError: vi.fn()
}))

vi.mock('@renderer/utils/markdown', () => ({
  purifyMarkdownImages: vi.fn((value) => value)
}))

vi.mock('@renderer/utils/messageUtils/find', () => ({
  findFileBlocks: vi.fn(),
  findImageBlocks: vi.fn(),
  getMainTextContent: vi.fn()
}))

vi.mock('@renderer/utils/prompt', () => ({
  containsSupportedVariables: vi.fn(),
  replacePromptVariables: vi.fn()
}))

vi.mock('@renderer/aiCore', () => ({
  AiProvider: vi.fn(),
  AiProviderConfig: {}
}))

vi.mock('../AssistantService', () => ({
  getDefaultAssistant: vi.fn(),
  getDefaultModel: vi.fn(),
  getProviderByModel: vi.fn(),
  getQuickModel: vi.fn()
}))

vi.mock('../ConversationService', () => ({
  ConversationService: {}
}))

vi.mock('../KnowledgeService', () => ({
  injectUserMessageWithKnowledgeSearchPrompt: vi.fn()
}))

function createProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'openai',
    type: 'openai',
    name: 'Provider',
    apiKey: 'key',
    apiHost: 'https://example.com',
    models: [],
    ...overrides
  }
}

describe('getSummaryRequestTimeoutMs', () => {
  it('returns 90 seconds for Ollama providers', async () => {
    const { getSummaryRequestTimeoutMs } = await import('../ApiService')

    expect(getSummaryRequestTimeoutMs(createProvider({ id: SystemProviderIds.ollama, type: 'ollama' }))).toBe(90_000)
  })

  it('returns 90 seconds for LM Studio providers', async () => {
    const { getSummaryRequestTimeoutMs } = await import('../ApiService')

    expect(getSummaryRequestTimeoutMs(createProvider({ id: SystemProviderIds.lmstudio }))).toBe(90_000)
  })

  it('keeps 15 seconds for non-local providers', async () => {
    const { getSummaryRequestTimeoutMs } = await import('../ApiService')

    expect(getSummaryRequestTimeoutMs(createProvider({ id: SystemProviderIds.openai, type: 'openai' }))).toBe(15_000)
  })
})
