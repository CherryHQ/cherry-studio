/**
 * The "Claude Code" provider lets an agent run against the user's existing
 * Claude Code CLI subscription login (Claude Pro/Max OAuth) instead of an API
 * key. It is **agent-only**: the Claude Agent SDK reuses the CLI's stored
 * credential when no `ANTHROPIC_API_KEY` is injected, so this provider carries
 * no key and must not be offered to chat/assistants. The agent-only behavior is
 * driven by the provider's `authMethods` including `'external-cli'` capability
 * (see `src/main/ai/runtime/claudeCode/settingsBuilder.ts` for env wiring); this
 * id helper is only for the bespoke UI surfaces keyed to this specific provider.
 *
 * The provider row and its default models live in the shipped registry
 * (`packages/provider-registry/data/{providers,provider-models}.json`); the
 * registry-sourced model list (`modelListSource === 'registry'`) is returned by
 * the backend instead of an upstream API call.
 */
export const CLAUDE_CODE_PROVIDER_ID = 'claude-code' as const

/** True for the canonical, undeletable Claude Code provider (agent-only, login-based). */
export function isClaudeCodeProviderId(providerId: string): boolean {
  return providerId === CLAUDE_CODE_PROVIDER_ID
}
