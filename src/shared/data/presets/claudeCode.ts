/**
 * The "Claude Code" provider lets an agent run against the user's existing
 * Claude Code CLI subscription login (Claude Pro/Max OAuth) instead of an API
 * key. It is **agent-only**: the Claude Agent SDK reuses the CLI's stored
 * credential when no `ANTHROPIC_API_KEY` is injected, so this provider carries
 * no key and must not be offered to chat/assistants. See
 * `src/main/ai/runtime/claudeCode/settingsBuilder.ts` (env wiring) and
 * `src/renderer/hooks/agents/useAgentModelFilter.ts` (picker gating).
 *
 * The provider row and its default models live in the shipped registry
 * (`packages/provider-registry/data/{providers,provider-models}.json`); the
 * `ClaudeCodeProviderSeeder` enables the row and materializes those models into
 * `user_model` (this provider cannot pull a model list over the API).
 */
export const CLAUDE_CODE_PROVIDER_ID = 'claude-code' as const

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
