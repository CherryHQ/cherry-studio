import type { AiUsageCredentialReceipt } from '@main/ai/types'

export type ServingAuthMethod = Extract<AiUsageCredentialReceipt, { attribution: 'auth' }>['method']

/**
 * Non-secret receipt for the credential path selected by provider configuration.
 *
 * API-key identity comes from ProviderService's atomic selection. Provider-level
 * authentication is declared by the config builder that installs it. Unknown is
 * used whenever the request owner cannot prove which credential served.
 */
export type ServingCredentialReceipt = AiUsageCredentialReceipt
