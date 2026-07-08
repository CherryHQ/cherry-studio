import { defineProvider } from './types'

/**
 * Agent-only login provider that reuses the Claude Code CLI's subscription
 * credential (`authMethods: ['external-cli']`) — no API key, model list served
 * from this registry (`modelListSource: 'registry'`) instead of an upstream
 * `/models` call. Runtime behavior lives in `src/main/ai/runtime/claudeCode/`.
 */
export default defineProvider({
  id: 'claude-code',
  name: 'Claude Code',
  defaultChatEndpoint: 'anthropic-messages',
  modelListSource: 'registry',
  authMethods: ['external-cli'],
  endpointConfigs: {
    'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
  },
  metadata: {
    website: {
      official: 'https://www.anthropic.com/claude-code',
      docs: 'https://docs.claude.com/en/docs/claude-code/overview'
    }
  },
  overrides: [
    { modelId: 'claude-fable-5' },
    { modelId: 'claude-opus-4-8' },
    { modelId: 'claude-opus-4-7' },
    { modelId: 'claude-opus-4-6' },
    { modelId: 'claude-opus-4-5' },
    { modelId: 'claude-opus-4-1' },
    { modelId: 'claude-sonnet-4-6' },
    { modelId: 'claude-sonnet-4-5' },
    { modelId: 'claude-haiku-4-5' }
  ]
})
