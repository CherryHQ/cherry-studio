import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  getProviderByModel: vi.fn(),
  getAssistantSettings: vi.fn(),
  getDefaultAssistant: vi.fn().mockReturnValue({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    settings: {}
  })
}))

vi.mock('@renderer/store', () => {
  const mockGetState = vi.fn()
  return {
    default: {
      getState: mockGetState
    },
    __mockGetState: mockGetState
  }
})

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
  })),
  isWithTrailingSharp: vi.fn((host) => host?.endsWith('#') || false)
}))

vi.mock('@renderer/utils/provider', async (importOriginal) => {
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

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn(),
  getAssistantSettings: vi.fn(),
  getDefaultAssistant: vi.fn().mockReturnValue({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    settings: {}
  })
}))

import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model, Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { isAzureOpenAIProvider, isCherryAIProvider, isPerplexityProvider } from '@renderer/utils/provider'

import { COPILOT_DEFAULT_HEADERS, COPILOT_EDITOR_VERSION, isCopilotResponsesModel } from '../constants'
import { getActualProvider, providerToAiSdkConfig } from '../providerConfig'

const { __mockGetState: mockGetState } = vi.mocked(await import('@renderer/store')) as any

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

const createAzureProvider = (apiVersion: string): Provider => ({
  id: 'azure-openai',
  type: 'azure-openai',
  name: 'Azure OpenAI',
  apiKey: 'test-key',
  apiHost: 'https://example.openai.azure.com/openai',
  apiVersion,
  models: [],
  isSystem: true
})

const createMoonshotProvider = (): Provider => ({
  id: 'moonshot',
  type: 'openai',
  name: 'Moonshot',
  apiKey: 'test-key',
  apiHost: 'https://api.moonshot.cn',
  models: [],
  isSystem: true
})

const createCustomMoonshotCompatibleProvider = (): Provider => ({
  id: 'custom-moonshot',
  type: 'openai',
  name: 'Custom Moonshot',
  apiKey: 'test-key',
  apiHost: 'https://api.moonshot.cn/v1',
  models: [],
  isSystem: false
})

describe('Copilot responses routing', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: undefined
          }
        }
      }
    })
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
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: undefined
          }
        }
      }
    })
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
    // Mock isWithTrailingSharp to return false for this test
    vi.mocked(formatApiHost as any).mockImplementation((host, isSupportedAPIVersion = true) => {
      if (isSupportedAPIVersion === false) {
        return host
      }
      return `${host}/v1`
    })

    // Call getActualProvider
    const actualProvider = getActualProvider(model)

    // Verify that formatApiHost was called with appendApiVersion parameter
    expect(formatApiHost).toHaveBeenCalledWith('https://api.openai.com', true)
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
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: undefined
          }
        }
      }
    })
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
    // Mock isWithTrailingSharp to return false for this test
    vi.mocked(formatApiHost as any).mockImplementation((host, isSupportedAPIVersion = true) => {
      if (isSupportedAPIVersion === false) {
        return host
      }
      return `${host}/v1`
    })

    // Call getActualProvider
    const actualProvider = getActualProvider(model)

    // Verify that formatApiHost was called with appendApiVersion parameter
    expect(formatApiHost).toHaveBeenCalledWith('https://api.openai.com', true)
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

describe('Stream options includeUsage configuration', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
    vi.clearAllMocks()
  })

  const createOpenAIProvider = (): Provider => ({
    id: 'openai-compatible',
    type: 'openai',
    name: 'OpenAI',
    apiKey: 'test-key',
    apiHost: 'https://api.openai.com',
    models: [],
    isSystem: true
  })

  it('uses includeUsage from settings when undefined', () => {
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: undefined
          }
        }
      }
    })

    const provider = createOpenAIProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4', 'GPT-4', 'openai'))

    expect(config.options.includeUsage).toBeUndefined()
  })

  it('uses includeUsage from settings when set to true', () => {
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: true
          }
        }
      }
    })

    const provider = createOpenAIProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4', 'GPT-4', 'openai'))

    expect(config.options.includeUsage).toBe(true)
  })

  it('uses includeUsage from settings when set to false', () => {
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: false
          }
        }
      }
    })

    const provider = createOpenAIProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4', 'GPT-4', 'openai'))

    expect(config.options.includeUsage).toBe(false)
  })

  it('respects includeUsage setting for non-supporting providers', () => {
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: true
          }
        }
      }
    })

    const testProvider: Provider = {
      id: 'test',
      type: 'openai',
      name: 'test',
      apiKey: 'test-key',
      apiHost: 'https://api.test.com',
      models: [],
      isSystem: false,
      apiOptions: {
        isNotSupportStreamOptions: true
      }
    }

    const config = providerToAiSdkConfig(testProvider, createModel('gpt-4', 'GPT-4', 'test'))

    // Even though setting is true, provider doesn't support it, so includeUsage should be undefined
    expect(config.options.includeUsage).toBeUndefined()
  })

  it('uses includeUsage from settings for Copilot provider when set to false', () => {
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: false
          }
        }
      }
    })

    const provider = createCopilotProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4', 'GPT-4', 'copilot'))

    expect(config.options.includeUsage).toBe(false)
    expect(config.providerId).toBe('github-copilot-openai-compatible')
  })

  it('uses includeUsage from settings for Copilot provider when set to true', () => {
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: true
          }
        }
      }
    })

    const provider = createCopilotProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4', 'GPT-4', 'copilot'))

    expect(config.options.includeUsage).toBe(true)
    expect(config.providerId).toBe('github-copilot-openai-compatible')
  })

  it('uses includeUsage from settings for Copilot provider when undefined', () => {
    mockGetState.mockReturnValue({
      copilot: { defaultHeaders: {} },
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: undefined
          }
        }
      }
    })

    const provider = createCopilotProvider()
    const config = providerToAiSdkConfig(provider, createModel('gpt-4', 'GPT-4', 'copilot'))

    expect(config.options.includeUsage).toBeUndefined()
    expect(config.providerId).toBe('github-copilot-openai-compatible')
  })
})

describe('Azure OpenAI traditional API routing', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
    mockGetState.mockReturnValue({
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: undefined
          }
        }
      }
    })

    vi.mocked(isAzureOpenAIProvider).mockImplementation((provider) => provider.type === 'azure-openai')
  })

  it('uses deployment-based URLs when apiVersion is a date version', () => {
    const provider = createAzureProvider('2024-02-15-preview')
    const config = providerToAiSdkConfig(provider, createModel('gpt-4o', 'GPT-4o', provider.id))

    expect(config.providerId).toBe('azure')
    expect(config.options.apiVersion).toBe('2024-02-15-preview')
    expect(config.options.useDeploymentBasedUrls).toBe(true)
  })

  it('does not force deployment-based URLs for apiVersion v1/preview', () => {
    const v1Provider = createAzureProvider('v1')
    const v1Config = providerToAiSdkConfig(v1Provider, createModel('gpt-4o', 'GPT-4o', v1Provider.id))
    expect(v1Config.providerId).toBe('azure-responses')
    expect(v1Config.options.apiVersion).toBe('v1')
    expect(v1Config.options.useDeploymentBasedUrls).toBeUndefined()

    const previewProvider = createAzureProvider('preview')
    const previewConfig = providerToAiSdkConfig(previewProvider, createModel('gpt-4o', 'GPT-4o', previewProvider.id))
    expect(previewConfig.providerId).toBe('azure-responses')
    expect(previewConfig.options.apiVersion).toBe('preview')
    expect(previewConfig.options.useDeploymentBasedUrls).toBeUndefined()
  })
})

describe('Moonshot outbound fetch normalization', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      keyv: createWindowKeyv()
    }
    mockGetState.mockReturnValue({
      settings: {
        openAI: {
          streamOptions: {
            includeUsage: undefined
          }
        }
      }
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('injects builtin_function.$web_search when tools is empty array', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = mockedFetch as unknown as typeof fetch

    const provider = createMoonshotProvider()
    const model = createModel('kimi-k2-0711-preview', 'Kimi K2', provider.id)
    const config = providerToAiSdkConfig(provider, model)

    const requestBody = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search latest Qwen3.5 models' }],
      tools: [],
      tool_choice: 'auto',
      stream: true
    }

    await config.options.fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    } as RequestInit)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = mockedFetch.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    expect(body.tools).toEqual([
      {
        type: 'builtin_function',
        function: {
          name: '$web_search'
        }
      }
    ])
  })

  it('does not inject when tool_choice is none', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = mockedFetch as unknown as typeof fetch

    const provider = createMoonshotProvider()
    const model = createModel('kimi-k2-0711-preview', 'Kimi K2', provider.id)
    const config = providerToAiSdkConfig(provider, model)

    const requestBody = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search latest Qwen3.5 models' }],
      tools: [],
      tool_choice: 'none',
      stream: true
    }

    await config.options.fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    } as RequestInit)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = mockedFetch.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    expect(body.tools).toEqual([])
  })

  it('injects builtin_function.$web_search for custom provider pointing to moonshot host', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = mockedFetch as unknown as typeof fetch

    const provider = createCustomMoonshotCompatibleProvider()
    const model = createModel('kimi-k2-0711-preview', 'Kimi K2', provider.id)
    const config = providerToAiSdkConfig(provider, model)

    const requestBody = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search latest Qwen3.5 models' }],
      tools: [],
      tool_choice: 'auto',
      stream: true
    }

    await config.options.fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    } as RequestInit)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = mockedFetch.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    expect(body.tools).toEqual([
      {
        type: 'builtin_function',
        function: {
          name: '$web_search'
        }
      }
    ])
  })

  it('fills tool message name from assistant tool_calls for moonshot', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = mockedFetch as unknown as typeof fetch

    const provider = createMoonshotProvider()
    const model = createModel('kimi-k2-0711-preview', 'Kimi K2', provider.id)
    const config = providerToAiSdkConfig(provider, model)

    const requestBody = {
      model: 'kimi-k2-0711-preview',
      messages: [
        { role: 'user', content: '请你使用内置搜索，搜索并总结 Qwen3.5 系列的模型' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 't-web-search-1',
              type: 'builtin_function',
              function: {
                name: '$web_search',
                arguments: '{"search_result":{"search_id":"search_123"}}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 't-web-search-1',
          content: '{"search_result":{"search_id":"search_123"}}'
        }
      ],
      tools: [
        {
          type: 'builtin_function',
          function: {
            name: '$web_search'
          }
        }
      ],
      tool_choice: 'auto',
      stream: true
    }

    await config.options.fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    } as RequestInit)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = mockedFetch.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    const toolMessage = body.messages.find((message: { role?: string }) => message.role === 'tool')
    expect(toolMessage).toMatchObject({
      role: 'tool',
      tool_call_id: 't-web-search-1',
      name: '$web_search',
      content: '{"search_result":{"search_id":"search_123"}}'
    })
  })

  it('normalizes assistant tool_call type to builtin_function for moonshot', async () => {
    const mockedFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = mockedFetch as unknown as typeof fetch

    const provider = createMoonshotProvider()
    const model = createModel('kimi-k2-0711-preview', 'Kimi K2', provider.id)
    const config = providerToAiSdkConfig(provider, model)

    const requestBody = {
      model: 'kimi-k2-0711-preview',
      messages: [
        { role: 'user', content: '请你使用内置搜索，搜索并总结 Qwen3.5 系列的模型' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 't-web-search-2',
              type: 'function',
              function: {
                name: '$web_search',
                arguments: '{"search_result":{"search_id":"search_234"}}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 't-web-search-2',
          name: '$web_search',
          content: '{"search_result":{"search_id":"search_234"}}'
        }
      ],
      tools: [
        {
          type: 'builtin_function',
          function: {
            name: '$web_search'
          }
        }
      ],
      tool_choice: 'auto',
      stream: true
    }

    await config.options.fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    } as RequestInit)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = mockedFetch.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    const assistantMessage = body.messages.find((message: { role?: string }) => message.role === 'assistant')
    expect(assistantMessage.tool_calls[0]).toMatchObject({
      id: 't-web-search-2',
      type: 'builtin_function',
      function: {
        name: '$web_search',
        arguments: '{"search_result":{"search_id":"search_234"}}'
      }
    })
  })
})
