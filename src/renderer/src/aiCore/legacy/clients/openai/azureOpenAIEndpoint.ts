export function normalizeAzureOpenAIEndpoint(apiHost: string): string {
  const normalizedHost = apiHost.replace(/\/+$/, '')
  return normalizedHost.replace(/\/openai(?:\/v1)?$/i, '')
}
