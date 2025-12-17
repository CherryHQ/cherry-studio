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
    settings: {
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
    }
  })),
  getDefaultModel: vi.fn(() => ({
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    group: 'openai'
  })),
  getAssistantSettings: vi.fn((assistant: any) => assistant?.settings ?? {}),
  getProviderByModel: vi.fn(() => ({
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    apiKey: '',
    apiHost: 'https://example.com/v1',
    models: []
  })),
  getDefaultTopic: vi.fn(() => ({
    id: 'topic-1',
    assistantId: 'default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Default Topic',
    messages: [],
    isNameManuallyEdited: false
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

describe('parameterBuilder.buildStreamTextParams', () => {
  it('uses default max tool steps when unset', async () => {
    const model = createModel()
    const assistant = createAssistant(model)
    const provider = createProvider(model)

    const { params } = await buildStreamTextParams([], assistant, provider, {})
    const stopWhen = params.stopWhen as any

    expect(stopWhen({ steps: new Array(19) })).toBe(false)
    expect(stopWhen({ steps: new Array(20) })).toBe(true)
  })

  it('uses provider.maxToolSteps when set', async () => {
    const model = createModel()
    const assistant = createAssistant(model)
    const provider = createProvider(model, { maxToolSteps: 42 })

    const { params } = await buildStreamTextParams([], assistant, provider, {})
    const stopWhen = params.stopWhen as any

    expect(stopWhen({ steps: new Array(41) })).toBe(false)
    expect(stopWhen({ steps: new Array(42) })).toBe(true)
  })

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
