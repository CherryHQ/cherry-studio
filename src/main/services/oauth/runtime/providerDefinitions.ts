import { providerService } from '@data/services/ProviderService'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { cherryInOAuthProvider } from './providers/cherryin'
import { codexOAuthProvider } from './providers/codex'
import { grokOAuthProvider } from './providers/grok'
import { createVertexGoogleOAuthProvider } from './providers/vertexGoogle'
import type { OAuthRuntimeProviderDefinition } from './types'

/**
 * Registry of OAuth runtime definitions, one entry per login-based provider.
 * Each provider's config + flow lives in its own `providers/<id>.ts`; this file
 * only wires them onto their provider ids. Add a provider by dropping a new file
 * in `providers/` and registering it here.
 */
export const oauthProviderDefinitions = {
  [OPENAI_CODEX_PROVIDER_ID]: codexOAuthProvider,
  [GROK_CLI_PROVIDER_ID]: grokOAuthProvider,
  [SystemProviderIds.cherryin]: cherryInOAuthProvider,
  [SystemProviderIds.vertexai]: createVertexGoogleOAuthProvider(SystemProviderIds.vertexai)
} satisfies Record<string, OAuthRuntimeProviderDefinition>

export type OAuthProviderId = keyof typeof oauthProviderDefinitions

const userVertexDefinitions = new Map<string, OAuthRuntimeProviderDefinition>()

/**
 * The OAuth definition for a provider id: its registered entry, or — for any
 * available user-created provider whose authConfig is `iam-gcp` — Vertex AI
 * "Sign in with Google". `undefined` when the provider has no OAuth flow.
 */
export function resolveOAuthProviderDefinition(providerId: string): OAuthRuntimeProviderDefinition | undefined {
  const registered = oauthProviderDefinitions[providerId as OAuthProviderId]
  if (registered) return registered

  let definition = userVertexDefinitions.get(providerId)
  if (
    !definition &&
    providerService.isAvailableByProviderId(providerId) &&
    providerService.getAuthConfig(providerId)?.type === 'iam-gcp'
  ) {
    definition = createVertexGoogleOAuthProvider(providerId)
    userVertexDefinitions.set(providerId, definition)
  }
  return definition
}
