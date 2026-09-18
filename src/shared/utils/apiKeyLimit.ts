// Shared so the settings form and the credential picker agree on one key shape.

/** Identifies a credential's quota entry in `chat.routing.api_key_limits`. */
export const apiKeyLimitId = (providerId: string, keyId: string) => `${providerId}::${keyId}`

/** Model-scoped limit: checked first, falls back to `apiKeyLimitId` if absent. */
export const apiKeyModelLimitId = (providerId: string, keyId: string, modelId: string) =>
  `${providerId}::${keyId}::${modelId}`
