import { defineProvider } from './types'

export default defineProvider({
  id: 'tokenlab',
  name: 'TokenLab',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.tokenlab.sh'
    },
    'google-generate-content': {
      adapterFamily: 'google',
      baseUrl: 'https://api.tokenlab.sh'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.tokenlab.sh/v1'
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.tokenlab.sh/v1'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://tokenlab.sh/dashboard',
      docs: 'https://docs.tokenlab.sh/guides/api-formats',
      models: 'https://api.tokenlab.sh/v1/models',
      official: 'https://tokenlab.sh/'
    }
  },
  overrides: [
    { modelId: 'claude-fable-5', endpointTypes: ['anthropic-messages'] },
    { modelId: 'claude-opus-4-8', endpointTypes: ['anthropic-messages'] },
    { modelId: 'claude-sonnet-5', endpointTypes: ['anthropic-messages'] },
    { modelId: 'glm-5-2', apiModelId: 'glm-5.2' },
    { modelId: 'deepseek-v4-pro' },
    { modelId: 'deepseek-v4-flash' },
    { modelId: 'gpt-5-5', apiModelId: 'gpt-5.5', endpointTypes: ['openai-responses'] },
    { modelId: 'gpt-5-4', apiModelId: 'gpt-5.4', endpointTypes: ['openai-responses'] },
    { modelId: 'gpt-5-4-mini', apiModelId: 'gpt-5.4-mini', endpointTypes: ['openai-responses'] },
    { modelId: 'minimax-m3' },
    { modelId: 'kimi-k2-7-code', apiModelId: 'kimi-k2.7-code' },
    { modelId: 'qwen3-7-max', apiModelId: 'qwen3.7-max' },
    { modelId: 'gemini-3-5-flash', apiModelId: 'gemini-3.5-flash', endpointTypes: ['google-generate-content'] },
    {
      modelId: 'gemini-3-1-flash-lite',
      apiModelId: 'gemini-3.1-flash-lite',
      endpointTypes: ['google-generate-content']
    },
    { modelId: 'grok-4-3', apiModelId: 'grok-4.3' },
    { modelId: 'grok-4-fast' }
  ]
})
