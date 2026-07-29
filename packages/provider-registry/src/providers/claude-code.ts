import { defineProvider } from './types'

/**
 * Models the CLI can run with the 1M-token window, paired with their catalog name.
 *
 * Claude Code budgets 200K per session unless the model id carries a `[1m]`
 * suffix (`/model claude-opus-5[1m]`); the suffix is a CLI concept that never
 * reaches the Messages API, so it lives in `apiModelId` while `modelId` keeps
 * resolving to the same catalog model. Extended context covers Opus 4.6+ and
 * Sonnet 4.6 — Fable 5 and Sonnet 5 always run at 1M and have no variant to
 * select, so they are served once.
 *
 * @see https://code.claude.com/docs/en/model-config#extended-context
 */
const EXTENDED_CONTEXT_MODELS = [
  ['claude-opus-5', 'Claude Opus 5'],
  ['claude-opus-4-8', 'Claude Opus 4.8'],
  ['claude-opus-4-7', 'Claude Opus 4.7'],
  ['claude-opus-4-6', 'Claude Opus 4.6'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6']
] as const

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
    { modelId: 'claude-sonnet-5' },
    { modelId: 'claude-opus-4-5' },
    { modelId: 'claude-opus-4-1' },
    { modelId: 'claude-sonnet-4-5' },
    { modelId: 'claude-haiku-4-5' },
    // Each extended-context model is served twice: the plain id, and its `[1m]`
    // twin. The plain row pins `apiModelId` to its own id so it always claims the
    // canonical `providerId::modelId` slot, whatever order the rows are indexed in.
    ...EXTENDED_CONTEXT_MODELS.flatMap(([modelId, name]) => [
      { modelId, apiModelId: modelId },
      { modelId, apiModelId: `${modelId}[1m]`, name: `${name} (1M context)` }
    ])
  ]
})
