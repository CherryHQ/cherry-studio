/**
 * Providers whose image transport applies `PaintingData.requestTimeoutMs` to the
 * submit request. Everything else either reaches the vendor through the AI SDK's
 * own path or uses a transport with a fixed budget, so the override would be inert.
 */
const IMAGE_REQUEST_TIMEOUT_PROVIDERS: ReadonlySet<string> = new Set(['ppio', 'dashscope', 'modelscope', 'tokenhub'])

/** Whether the painting timeout override reaches the selected provider's image transport. */
export function supportsImageRequestTimeout(providerId: string | undefined): boolean {
  return providerId !== undefined && IMAGE_REQUEST_TIMEOUT_PROVIDERS.has(providerId)
}
