import { defineProvider } from './types'

/**
 * Models that need an explicit 1M-context twin, paired with their catalog name.
 *
 * Claude Code budgets 200K per session unless the model id carries a `[1m]`
 * suffix (`/model claude-opus-5[1m]`); the suffix is a CLI concept that never
 * reaches the Messages API, so it lives in `apiModelId` while `modelId` keeps
 * resolving to the same catalog model.
 *
 * Which models belong here is a BILLING question, not a capability one — Opus 5
 * and Sonnet 5 are both natively 1M. The 1M window on Opus is entitlement-gated
 * (included on Max/Team/Enterprise, billed to usage credits on Pro), so it must
 * be opted into; Sonnet 5's costs nothing extra on any plan, so the CLI always
 * runs it at 1M and offers no `[1m]` variant. When adding a model, check both:
 *
 * | Model                  | 1M support | Needs a `[1m]` twin                    |
 * | ---------------------- | ---------- | -------------------------------------- |
 * | Opus 4.6 / 4.7 / 4.8   | yes        | yes — Pro pays usage credits for it    |
 * | Opus 5                 | yes        | yes — same gating as the other Opuses  |
 * | Sonnet 4.6             | yes        | yes — credits on EVERY plan, incl. Max |
 * | Fable 5, Sonnet 5      | yes        | no — always 1M, nothing to select      |
 * | Opus 4.5 / 4.1, Sonnet 4.5, Haiku 4.5 | no | no — 200K models              |
 *
 * On a raw API key the twins are redundant (Opus 4.7+ always runs at 1M there),
 * but this provider signs in with a Pro/Max subscription, which is the gated path.
 *
 * @see https://code.claude.com/docs/en/model-config#extended-context — plan gating, `[1m]` syntax
 * @see https://platform.claude.com/docs/en/about-claude/models/overview — per-model context windows
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
  fastMode: { transport: 'claude-code' },
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
    ...EXTENDED_CONTEXT_MODELS.flatMap(([modelId, name]) => {
      const supportsFastMode = modelId === 'claude-opus-5' || modelId === 'claude-opus-4-8'
      const fastModeOverride = supportsFastMode ? { supportsFastMode: true } : {}

      return [
        { modelId, apiModelId: modelId, ...fastModeOverride },
        { modelId, apiModelId: `${modelId}[1m]`, name: `${name} (1M context)`, ...fastModeOverride }
      ]
    })
  ]
})
