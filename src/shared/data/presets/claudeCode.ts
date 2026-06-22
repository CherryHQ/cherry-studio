import { createUniqueModelId } from '@shared/data/types/model'

/**
 * The "Claude Code" provider lets an agent run against the user's existing
 * Claude Code CLI subscription login (Claude Pro/Max OAuth) instead of an API
 * key. It is **agent-only**: the Claude Agent SDK reuses the CLI's stored
 * credential when no `ANTHROPIC_API_KEY` is injected, so this provider carries
 * no key and must not be offered to chat/assistants. See
 * `src/main/ai/runtime/claudeCode/settingsBuilder.ts` (env wiring) and
 * `src/renderer/hooks/agents/useAgentModelFilter.ts` (picker gating).
 */
export const CLAUDE_CODE_PROVIDER_ID = 'claude-code' as const
export const CLAUDE_CODE_PROVIDER_NAME = 'Claude Code' as const
export const CLAUDE_CODE_API_BASE_URL = 'https://api.anthropic.com' as const

/**
 * Seeded default models. Custom rows (`presetModelId: null`) — ids double as
 * `ANTHROPIC_MODEL`. Ids use Anthropic's stable aliases (not date-stamped
 * snapshots) so each tracks its latest snapshot automatically. This is the set
 * of currently-active Claude models; bump it when Anthropic ships a new one.
 */
export const CLAUDE_CODE_DEFAULT_MODELS = [
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', group: 'Claude Opus' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', group: 'Claude Opus' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', group: 'Claude Opus' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', group: 'Claude Opus' },
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', group: 'Claude Opus' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', group: 'Claude Sonnet' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', group: 'Claude Sonnet' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', group: 'Claude Haiku' },
  { id: 'claude-fable-5', name: 'Claude Fable 5', group: 'Claude Fable' }
] as const

export const CLAUDE_CODE_DEFAULT_UNIQUE_MODEL_ID = createUniqueModelId(
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_DEFAULT_MODELS[0].id
)

/** True for the canonical, undeletable Claude Code provider (agent-only, login-based). */
export function isClaudeCodeProviderId(providerId: string): boolean {
  return providerId === CLAUDE_CODE_PROVIDER_ID
}

/**
 * True for providers usable only by agents, never by chat/assistants. Such
 * providers are hidden from general model selectors; agent pickers opt in.
 * Currently only `claude-code` (subscription login carries no API key, so it
 * cannot serve a normal chat request).
 */
export function isAgentOnlyProviderId(providerId: string): boolean {
  return providerId === CLAUDE_CODE_PROVIDER_ID
}
