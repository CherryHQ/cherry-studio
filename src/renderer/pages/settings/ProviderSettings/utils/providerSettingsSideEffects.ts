import type { AppDispatch } from '@renderer/store'
import { updateWebSearchProvider } from '@renderer/store/websearch'

export function applyProviderApiKeySideEffects(params: { providerId: string; apiKey: string; dispatch: AppDispatch }) {
  const { providerId, apiKey, dispatch } = params

  if (providerId === 'zhipu') {
    dispatch(
      updateWebSearchProvider({
        id: 'zhipu',
        apiKey: apiKey.split(',')[0] ?? ''
      })
    )
  }
}

export function applyProviderCustomHeaderSideEffects(params: {
  providerId: string
  headers: Record<string, string>
  updateCopilotHeaders?: (headers: Record<string, string>) => void
}) {
  if (params.providerId === 'copilot') {
    params.updateCopilotHeaders?.(params.headers)
  }
}
