const separator = '/models/'

export function antigravityGatewayModel(gatewayAddress: string) {
  const colon = gatewayAddress.indexOf(':')
  const providerId = gatewayAddress.slice(0, colon)
  if (colon < 1 || providerId.includes(separator)) {
    throw new Error(`Provider id "${providerId}" cannot be addressed by antigravity-cli using "${separator}"`)
  }
  return 'gemini-api://' + providerId + separator + gatewayAddress.slice(colon + 1)
}

/** Convert Antigravity's custom-model path back to the gateway's `providerId:apiModelId` address. */
export function normalizeAntigravityModelPath(model: string): string {
  const separatorIndex = model.indexOf(separator)
  if (separatorIndex <= 0) return model

  const providerId = model.slice(0, separatorIndex)
  const apiModelId = model.slice(separatorIndex + separator.length)
  if (!apiModelId || providerId.includes(':')) return model
  return `${providerId}:${apiModelId}`
}

export function antigravityGeminiSettings(settings: Record<string, unknown>) {
  return JSON.stringify({ ...settings, modelProvider: 'gemini' }, null, 2) + '\n'
}

export function antigravityGeminiEnvironment(apiKey: string, baseUrl: string): Record<string, string> {
  return { GEMINI_API_KEY: apiKey, ...(baseUrl ? { GOOGLE_GEMINI_BASE_URL: baseUrl } : {}) }
}

export function antigravityTerminalArgs(geminiDir: string, model: string) {
  return [`--gemini_dir=${geminiDir}`, '--model', model] as const
}
