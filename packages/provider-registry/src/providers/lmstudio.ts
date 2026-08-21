import { defineProvider } from './types'

export default defineProvider({
  id: 'lmstudio',
  name: 'LM Studio',
  authOptional: true,
  // Declared explicitly although LM Studio is a local provider: its baseUrl is
  // hardcoded (`http://localhost:1234`) in both endpoint configs, so there is
  // nothing dynamic to discover — and without a default the endpoint resolution
  // in runtime gating (`resolvePiApi` → `resolveEndpointType`) falls through to
  // `undefined` for models synced from `/models`, which carry no `endpointTypes`
  // metadata. That silently filtered every LM Studio model out of the Pi model
  // picker even though both declared endpoints are Pi-compatible.
  // See https://github.com/CherryHQ/cherry-studio/issues/19003
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:1234'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:1234',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      docs: 'https://lmstudio.ai/docs',
      models: 'https://lmstudio.ai/models',
      official: 'https://lmstudio.ai/'
    }
  }
})
