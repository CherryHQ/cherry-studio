import type { Assistant, Model, Provider } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/AssistantService', () => ({
  DEFAULT_ASSISTANT_SETTINGS: {
    temperature: 0.7,
    enableTemperature: true,
    contextCount: 5,
    enableMaxTokens: false,
    maxTokens: 0,
    streamOutput: true,
    topP: 1,
    enableTopP: false,
    toolUseMode: 'function',
    customParameters: []
  },
  getDefaultAssistant: vi.fn(() => ({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    type: 'assistant',
    topics: [],
    settings: {}
  })),
  getAssistantSettings: vi.fn((assistant: any) => assistant?.settings ?? {}),
  getDefaultModel: vi.fn(() => ({
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    group: 'openai'
  })),
  getProviderByModel: vi.fn(() => ({
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    apiKey: '',
    apiHost: 'https://example.com/v1',
    models: []
  }))
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({
      websearch: {
        maxResults: 5,
        excludeDomains: [],
        searchWithTime: false
      }
    }))
  }
}))

vi.mock('@renderer/utils/prompt', () => ({
  replacePromptVariables: vi.fn(async (prompt: string) => prompt)
}))

vi.mock('../../utils/mcp', () => ({
  setupToolsConfig: vi.fn(() => undefined)
}))

vi.mock('../../utils/options', () => ({
  buildProviderOptions: vi.fn(() => ({
    providerOptions: {},
    standardParams: {}
  }))
}))

import { buildStreamTextParams } from '../parameterBuilder'

const createModel = (): Model => ({
  id: 'gpt-4o',
  provider: 'openai',
  name: 'GPT-4o',
  group: 'openai'
})

const createAssistant = (model: Model): Assistant => ({
  id: 'assistant-1',
  name: 'Assistant',
  prompt: '',
  type: 'assistant',
  topics: [],
  model,
  settings: {}
})

const createProvider = (model: Model, overrides: Partial<Provider> = {}): Provider => ({
  id: 'openai-response',
  type: 'openai-response',
  name: 'OpenAI Responses',
  apiKey: 'test',
  apiHost: 'https://example.com/v1',
  models: [model],
  ...overrides
})

describe('parameterBuilder.buildStreamTextParams (timeouts)', () => {
  it('returns streamingConfig and abortSignal when SSE idle timeout is enabled', async () => {
    const model = createModel()
    const assistant = createAssistant(model)
    const provider = createProvider(model, { sseIdleTimeoutMinutes: 10 })

    const userAbortController = new AbortController()

    const { params, streamingConfig } = await buildStreamTextParams([], assistant, provider, {
      requestOptions: { signal: userAbortController.signal }
    })

    expect(streamingConfig?.idleTimeoutMs).toBe(10 * 60 * 1000)
    expect(streamingConfig?.idleAbortController).toBeInstanceOf(AbortController)
    expect(params.abortSignal).toBeDefined()

    userAbortController.abort()
    expect(params.abortSignal?.aborted).toBe(true)
  })
})
