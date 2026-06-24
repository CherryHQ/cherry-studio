/**
 * The "OpenAI Codex" provider lets the app talk to the ChatGPT backend codex
 * endpoint using the user's existing ChatGPT Plus/Pro subscription via OAuth
 * (PKCE), instead of a platform API key. Unlike `claude-code` (agent-only,
 * credential reused from the CLI), Codex is usable for normal chat and the app
 * manages the OAuth flow itself: `CodexOauthService` runs the loopback-server
 * authorization-code flow, stores `access`/`refresh`/`accountId` in the
 * provider's `authConfig`, and the runtime config builder injects the bearer
 * token + `chatgpt-account-id` header per request (refreshing on expiry).
 *
 * The provider row and its default models live in the shipped registry
 * (`packages/provider-registry/data/{providers,provider-models}.json`); the
 * `CodexProviderSeeder` materializes those models into `user_model` (this
 * provider cannot pull a model list over the API). The row stays disabled until
 * the user completes OAuth sign-in.
 */
export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex' as const

/** True for the canonical, login-based OpenAI Codex provider. */
export function isCodexProviderId(providerId: string): boolean {
  return providerId === OPENAI_CODEX_PROVIDER_ID
}
