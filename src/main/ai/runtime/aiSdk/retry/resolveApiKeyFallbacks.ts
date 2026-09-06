import type { ServingCredentialReceipt } from '@main/ai/provider/credential'
import type { ApiKeyEntry } from '@shared/data/types/provider'

/** Remaining enabled keys in round-robin order after the key serving the first attempt. */
export function resolveApiKeyFallbacks(
  apiKeys: ApiKeyEntry[],
  credentialReceipt: ServingCredentialReceipt,
  apiKeyOverride?: string
): ApiKeyEntry[] {
  if (apiKeyOverride !== undefined || !('id' in credentialReceipt)) return []

  const enabledKeys = apiKeys.filter((key) => key.isEnabled)
  const selectedIndex = enabledKeys.findIndex((key) => key.id === credentialReceipt.id)
  if (selectedIndex < 0 || enabledKeys.length < 2) return []

  return [...enabledKeys.slice(selectedIndex + 1), ...enabledKeys.slice(0, selectedIndex)]
}
