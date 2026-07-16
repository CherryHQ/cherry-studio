/**
 * Runtime transport adapters — the provider layer's "how to call me" for
 * app-managed-OAuth providers (`grok-cli`, `openai-codex`).
 *
 * These providers speak the OpenAI Responses surface but authenticate with a
 * refreshed OAuth token + provider-specific headers, and need their request
 * payload reshaped before it is sent. The aiSdk chat path handles that inside a
 * custom `fetch` (see `config.ts`); an agent runtime (pi) has no `fetch` seam,
 * so it instead injects `{ apiKey, headers, onPayload }` into the api-family
 * stream. This module exposes that shaping as a runtime-NEUTRAL object composing
 * the same pure helpers the aiSdk path uses, so the pi bridge stays generic and
 * never learns any grok/codex specifics.
 */
import { application } from '@application'
import type { PI_TRANSPORT_ADAPTER_PROVIDER_IDS } from '@shared/ai/piModelCompatibility'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'

import { buildCodexRequestHeaders, coerceCodexRequestJson } from './codex'
import { buildGrokCliRequestHeaders, rewriteGrokCliResponsesBody } from './grokCli'

export interface TransportCredentials {
  accessToken: string
  accountId?: string | null
}

export interface ProviderTransportAdapter {
  /** Fresh credentials for one stream call (refreshes if expired). */
  resolveCredentials(): Promise<TransportCredentials>
  /** Extra request headers for this call, including the OAuth `Authorization`. */
  buildHeaders(creds: TransportCredentials, modelId: string): Record<string, string>
  /** Rewrite the parsed request payload into the provider's accepted shape. */
  rewritePayload(json: Record<string, any>): Record<string, any>
}

/** Convert a built `Headers` into the plain record pi's stream options expect. */
function toRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

/**
 * Fetch a fresh OAuth token via the shared runtime service (refreshing when
 * expired) — the SAME single source of refresh logic the aiSdk fetch path uses.
 * Throws when the user is not signed in so the stream terminates with a clear error.
 */
async function resolveOAuthCredentials(providerId: string): Promise<TransportCredentials> {
  const creds = await application.get('OAuthRuntimeService').getValidAccessToken(providerId)
  if (!creds?.accessToken) {
    throw new Error(`Not signed in to ${providerId}. Open the provider settings and sign in again.`)
  }
  return { accessToken: creds.accessToken, accountId: creds.accountId ?? null }
}

const grokCliAdapter: ProviderTransportAdapter = {
  resolveCredentials: () => resolveOAuthCredentials(GROK_CLI_PROVIDER_ID),
  buildHeaders: (creds, modelId) =>
    toRecord(buildGrokCliRequestHeaders(undefined, { accessToken: creds.accessToken, modelId })),
  rewritePayload: (json) => rewriteGrokCliResponsesBody(json)
}

const codexAdapter: ProviderTransportAdapter = {
  resolveCredentials: () => resolveOAuthCredentials(OPENAI_CODEX_PROVIDER_ID),
  buildHeaders: (creds) =>
    toRecord(
      buildCodexRequestHeaders(undefined, { accessToken: creds.accessToken, accountId: creds.accountId ?? null })
    ),
  rewritePayload: (json) => coerceCodexRequestJson(json)
}

/**
 * Adapter registry, keyed by the SAME provider ids the shared compatibility
 * predicate exposes. The record type is derived from
 * {@link PI_TRANSPORT_ADAPTER_PROVIDER_IDS}, so adding an id there without an
 * adapter here (or vice versa) is a compile error — the two cannot drift.
 */
const TRANSPORT_ADAPTERS: Record<(typeof PI_TRANSPORT_ADAPTER_PROVIDER_IDS)[number], ProviderTransportAdapter> = {
  [GROK_CLI_PROVIDER_ID]: grokCliAdapter,
  [OPENAI_CODEX_PROVIDER_ID]: codexAdapter
}

/** The transport adapter for a provider, or `undefined` for plain api-key providers. */
export function getProviderTransportAdapter(providerId: string): ProviderTransportAdapter | undefined {
  return (TRANSPORT_ADAPTERS as Record<string, ProviderTransportAdapter>)[providerId]
}
