import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({ copilot: { defaultHeaders: {} } })
  }
}))

vi.mock('@renderer/utils/api', () => ({
  formatApiHost: vi.fn((host, isSupportedAPIVersion = true) => {
    if (isSupportedAPIVersion === false) {
      return host // Return host as-is when isSupportedAPIVersion is false
    }
    return `${host}/v1` // Default behavior when isSupportedAPIVersion is true
  }),
  routeToEndpoint: vi.fn((host) => ({
    baseURL: host,
    endpoint: '/chat/completions'
  }))
}))

vi.mock('@renderer/config/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    isCherryAIProvider: vi.fn(),
    isPerplexityProvider: vi.fn(),
    isAnthropicProvider: vi.fn(() => false),
    isAzureOpenAIProvider: vi.fn(() => false),
    isGeminiProvider: vi.fn(() => false),
    isNewApiProvider: vi.fn(() => false)
  }
})

vi.mock('@renderer/hooks/useVertexAI', () => ({
  isVertexProvider: vi.fn(() => false),
  isVertexAIConfigured: vi.fn(() => false),
  createVertexProvider: vi.fn()
}))

import { isCherryAIProvider, isPerplexityProvider } from '@renderer/config/providers'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model, Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'

import { COPILOT_DEFAULT_HEADERS, COPILOT_EDITOR_VERSION, isCopilotResponsesModel } from '../constants'
import { getActualProvider, providerToAiSdkConfig } from '../providerConfig'

const createWindowKeyv = () => {
  const store = new Map<string, string>()
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: string) => {
      store.set(key, value)
    }
  }
}

const createCopilotProvider = (): Provider => ({
  id: 'copilot',
  type: 'openai',
  name: 'GitHub Copilot',
  apiKey: 'test-key',
  apiHost: 'https://api.githubcopilot.com',
  models: [],
  isSystem: true
})

const createModel = (id: string, name = id, provider = 'copilot'): Model => ({
  id,
  name,
  provider,
  group: provider
})

const createCherryAIProvider = (): Provider => ({
  id: 'cherryai',
  type: 'openai',
  name: 'CherryAI',
  apiKey: 'test-key',
  apiHost: 'https://api.cherryai.com',
  models: [],
  isSystem: false
})

const createPerplexityProvider = (): Provider => ({
  id: 'perplexity',
  type: 'openai',
  name: 'Perplexity',
  apiKey: 'test-key',
  apiHost: 'https://api.perplexity.ai',
  models: [],
  isSystem: false
})

describe('Copilot responses routing', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
  })

  it('detects official GPT-5 Codex identifiers case-insensitively', () => {
    expect(isCopilotResponsesModel(createModel('gpt-5-codex', 'gpt-5-codex'))).toBe(true)
    expect(isCopilotResponsesModel(createModel('GPT-5-CODEX', 'GPT-5-CODEX'))).toBe(true)
    expect(isCopilotResponsesModel(createModel('gpt-5-codex', 'custom-name'))).toBe(true)
    expect(isCopilotResponsesModel(createModel('custom-id', 'custom-name'))).toBe(false)
  })

  it('configures gpt-5-codex with the Copilot provider', () => {
    const provider = createCopilotProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-5-codex', 'GPT-5-CODEX'))

    expect(config.providerId).toBe('github-copilot-openai-compatible')
    expect(config.options.headers?.['Editor-Version']).toBe(COPILOT_EDITOR_VERSION)
    expect(config.options.headers?.['Copilot-Integration-Id']).toBe(COPILOT_DEFAULT_HEADERS['Copilot-Integration-Id'])
    expect(config.options.headers?.['copilot-vision-request']).toBe('true')
  })

  it('uses the Copilot provider for other models and keeps headers', () => {
    const provider = createCopilotProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4'))

    expect(config.providerId).toBe('github-copilot-openai-compatible')
    expect(config.options.headers?.['Editor-Version']).toBe(COPILOT_DEFAULT_HEADERS['Editor-Version'])
    expect(config.options.headers?.['Copilot-Integration-Id']).toBe(COPILOT_DEFAULT_HEADERS['Copilot-Integration-Id'])
  })
})

describe('CherryAI provider configuration', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
    vi.clearAllMocks()
  })

  it('formats CherryAI provider apiHost with false parameter', () => {
    const provider = createCherryAIProvider()
    const model = createModel('gpt-4', 'GPT-4', 'cherryai')

    // Mock the functions to simulate CherryAI provider detection
    vi.mocked(isCherryAIProvider).mockReturnValue(true)
    vi.mocked(getProviderByModel).mockReturnValue(provider)

    // Call getActualProvider which should trigger formatProviderApiHost
    const actualProvider = getActualProvider(model)

    // Verify that formatApiHost was called with false as the second parameter
    expect(formatApiHost).toHaveBeenCalledWith('https://api.cherryai.com', false)
    expect(actualProvider.apiHost).toBe('https://api.cherryai.com')
  })

  it('does not format non-CherryAI provider with false parameter', () => {
    const provider = {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'test-key',
      apiHost: 'https://api.openai.com',
      models: [],
      isSystem: false
    } as Provider
    const model = createModel('gpt-4', 'GPT-4', 'openai')

    // Mock the functions to simulate non-CherryAI provider
    vi.mocked(isCherryAIProvider).mockReturnValue(false)
    vi.mocked(getProviderByModel).mockReturnValue(provider)

    // Call getActualProvider
    const actualProvider = getActualProvider(model)

    // Verify that formatApiHost was called with default parameters (true)
    expect(formatApiHost).toHaveBeenCalledWith('https://api.openai.com')
    expect(actualProvider.apiHost).toBe('https://api.openai.com/v1')
  })

  it('handles CherryAI provider with empty apiHost', () => {
    const provider = createCherryAIProvider()
    provider.apiHost = ''
    const model = createModel('gpt-4', 'GPT-4', 'cherryai')

    vi.mocked(isCherryAIProvider).mockReturnValue(true)
    vi.mocked(getProviderByModel).mockReturnValue(provider)

    const actualProvider = getActualProvider(model)

    expect(formatApiHost).toHaveBeenCalledWith('', false)
    expect(actualProvider.apiHost).toBe('')
  })
})

describe('Perplexity provider configuration', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
    vi.clearAllMocks()
  })

  it('formats Perplexity provider apiHost with false parameter', () => {
    const provider = createPerplexityProvider()
    const model = createModel('sonar', 'Sonar', 'perplexity')

    // Mock the functions to simulate Perplexity provider detection
    vi.mocked(isCherryAIProvider).mockReturnValue(false)
    vi.mocked(isPerplexityProvider).mockReturnValue(true)
    vi.mocked(getProviderByModel).mockReturnValue(provider)

    // Call getActualProvider which should trigger formatProviderApiHost
    const actualProvider = getActualProvider(model)

    // Verify that formatApiHost was called with false as the second parameter
    expect(formatApiHost).toHaveBeenCalledWith('https://api.perplexity.ai', false)
    expect(actualProvider.apiHost).toBe('https://api.perplexity.ai')
  })

  it('does not format non-Perplexity provider with false parameter', () => {
    const provider = {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'test-key',
      apiHost: 'https://api.openai.com',
      models: [],
      isSystem: false
    } as Provider
    const model = createModel('gpt-4', 'GPT-4', 'openai')

    // Mock the functions to simulate non-Perplexity provider
    vi.mocked(isCherryAIProvider).mockReturnValue(false)
    vi.mocked(isPerplexityProvider).mockReturnValue(false)
    vi.mocked(getProviderByModel).mockReturnValue(provider)

    // Call getActualProvider
    const actualProvider = getActualProvider(model)

    // Verify that formatApiHost was called with default parameters (true)
    expect(formatApiHost).toHaveBeenCalledWith('https://api.openai.com')
    expect(actualProvider.apiHost).toBe('https://api.openai.com/v1')
  })

  it('handles Perplexity provider with empty apiHost', () => {
    const provider = createPerplexityProvider()
    provider.apiHost = ''
    const model = createModel('sonar', 'Sonar', 'perplexity')

    vi.mocked(isCherryAIProvider).mockReturnValue(false)
    vi.mocked(isPerplexityProvider).mockReturnValue(true)
    vi.mocked(getProviderByModel).mockReturnValue(provider)

    const actualProvider = getActualProvider(model)

    expect(formatApiHost).toHaveBeenCalledWith('', false)
    expect(actualProvider.apiHost).toBe('')
  })
})
