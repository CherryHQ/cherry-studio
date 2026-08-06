import { defineProvider } from './types'
import { modeWire } from './wires'

const claudeWebToolModels = [
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]
const geminiWebToolModels = [
  'gemini-2',
  'gemini-3',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-flash-lite-latest'
]
const openAIWebSearchModels = ['gpt-4o', 'gpt-4-1', 'gpt-5', 'o3', 'o4']

const deepSeekThinkingWire = modeWire('extra_body.thinking.type', {
  off: 'disabled',
  auto: 'enabled',
  effort: 'enabled'
})

const deepSeekModels = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3-1', 'deepseek-v3-2']

export default defineProvider({
  id: 'new-api',
  name: 'New API',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000'
    },
    'openai-chat-completions': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      baseUrl: 'http://localhost:3000'
    },
    'google-generate-content': {
      baseUrl: 'http://localhost:3000'
    }
  },
  // Gateway-mapped delivery (same vendor-segment fallback as cherryin): a
  // self-hosted New API can front any model, but only vendors owning a native
  // tool factory actually receive one.
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebToolModels, ...geminiWebToolModels, ...openAIWebSearchModels],
      imageModelIds: ['gemini-3-pro-image', 'gemini-3-pro-image-preview'],
      vendors: ['anthropic', 'gemini', 'openai']
    },
    {
      id: 'url-context',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebToolModels, ...geminiWebToolModels],
      vendors: ['anthropic', 'gemini']
    }
  ],
  metadata: {
    website: {
      docs: 'https://docs.newapi.pro',
      official: 'https://docs.newapi.pro/'
    }
  },
  overrides: deepSeekModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }))
})
