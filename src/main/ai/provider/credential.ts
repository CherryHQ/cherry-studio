import type { ProviderApiKeySelection } from '@main/data/services/ProviderService'

export type ServingAuthMethod = 'oauth' | 'external-cli' | 'iam-aws' | 'api-key-aws' | 'iam-gcp' | 'iam-azure'

/**
 * Non-secret receipt for the credential path selected by provider configuration.
 *
 * API-key identity comes from ProviderService's atomic selection. Provider-level
 * authentication is declared by the config builder that installs it. Unknown is
 * used whenever the request owner cannot prove which credential served.
 */
export type ServingCredentialReceipt = ProviderApiKeySelection | { attribution: 'auth'; method: ServingAuthMethod }
