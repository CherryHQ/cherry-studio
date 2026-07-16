/**
 * pi provider-injection extension (plan D1).
 *
 * Registers the Cherry-resolved provider/model config with pi via
 * `pi.registerProvider`. The config carries only a non-secret placeholder key
 * (`PI_PLACEHOLDER_API_KEY`); the real Cherry key is injected separately through
 * the in-memory `AuthStorage` runtime override so raw keys never enter pi's
 * config-value interpolation or any persisted pi file.
 *
 * The connection ALSO registers the same provider directly on the in-memory
 * `ModelRegistry` before session creation — pi resolves the session model before
 * extensions bind, so direct registration is required to select the model. This
 * extension keeps the registration in place across any `resourceLoader` reload
 * (pi re-applies `extensionFactories` on reload) and is the D1-designated
 * injection point; both target the same registry, and `registerProvider` is an
 * idempotent upsert.
 */
import type { ExtensionAPI, ExtensionFactory, ProviderConfig } from '@earendil-works/pi-coding-agent'

export function createPiProviderExtension(providerName: string, providerConfig: ProviderConfig): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerProvider(providerName, providerConfig)
  }
}
