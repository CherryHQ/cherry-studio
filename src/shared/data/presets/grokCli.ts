/**
 * The "Grok CLI" provider lets the app reach xAI's Grok CLI proxy
 * (`cli-chat-proxy.grok.com`) using the user's SuperGrok subscription via OAuth
 * (PKCE + OIDC discovery), instead of an `api.x.ai` API key. Like `openai-codex`
 * it is a normal chat provider whose OAuth the app manages itself:
 * `OAuthRuntimeService` runs the loopback authorization-code flow, stores
 * `access`/`refresh` in the provider's `authConfig`, and the runtime config
 * builder injects the bearer token + Grok CLI proxy headers and rewrites the
 * Responses body into the shape xAI's proxy accepts (refreshing on expiry).
 *
 * The provider row and its default models (grok-build, grok-composer-2.5-fast)
 * live in the shipped registry (`packages/provider-registry/data/*`). Because
 * Grok CLI cannot list models over an API, its registry entry sets
 * `modelListSource: 'registry'`, so `AiService.listModels` serves the shipped
 * catalog at runtime (no DB seeding needed — same as `openai-codex` and
 * `claude-code`). The row stays disabled until the user completes OAuth sign-in.
 *
 * This is distinct from the existing api-key `grok` provider, which talks to
 * `api.x.ai` with a platform key.
 */
export const GROK_CLI_PROVIDER_ID = 'grok-cli' as const

/** True for the canonical, login-based Grok CLI provider. */
export function isGrokCliProviderId(providerId: string): boolean {
  return providerId === GROK_CLI_PROVIDER_ID
}
