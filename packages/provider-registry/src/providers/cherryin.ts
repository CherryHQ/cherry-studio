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
  id: 'cherryin',
  name: 'CherryIN',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    },
    'google-generate-content': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    },
    'openai-chat-completions': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  // Gateway-mapped delivery: `resolveToolCapability` falls back to the vendor
  // segment of the model provider id (`cherryin.gemini` → google's factory), so
  // only vendors owning a native tool factory are servable — a deepseek/glm/kimi
  // model would resolve no factory and inject nothing.
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
      apiKey: 'https://open.cherryin.ai/console/token',
      docs: 'https://open.cherryin.ai',
      models: 'https://open.cherryin.ai/pricing',
      official: 'https://open.cherryin.ai'
    }
  },
  overrides: deepSeekModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }))
})
