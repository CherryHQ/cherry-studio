import { DEFAULT_API_FEATURES, DEFAULT_PROVIDER_SETTINGS, type Provider } from '@shared/data/types/provider'
import { CLI_OWN_LOGIN_PROVIDER_ID } from '@shared/types/codeCli'

/**
 * Synthetic, page-local provider entry for the "use the CLI's own login" option.
 * It occupies a slot in a login-capable tool's provider list so the option can be
 * selected and reordered exactly like a real provider — but it is never persisted
 * to the providers store and never backs a real request. The row is rendered by
 * `OwnLoginCard` (not `ProviderCard`), so most of these fields are placeholders
 * that never surface in the UI; they exist only to satisfy the `Provider` shape.
 */
export const OWN_LOGIN_PROVIDER: Provider = {
  id: CLI_OWN_LOGIN_PROVIDER_ID,
  name: 'CLI own login',
  apiKeys: [],
  authType: 'oauth',
  authMethods: ['external-cli'],
  apiFeatures: DEFAULT_API_FEATURES,
  settings: DEFAULT_PROVIDER_SETTINGS,
  isEnabled: true
}
