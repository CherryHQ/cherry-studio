export function applyProviderCustomHeaderSideEffects(params: {
  providerId: string
  headers: Record<string, string>
  updateCopilotHeaders?: (headers: Record<string, string>) => void
}) {
  if (params.providerId === 'copilot') {
    params.updateCopilotHeaders?.(params.headers)
  }
}
