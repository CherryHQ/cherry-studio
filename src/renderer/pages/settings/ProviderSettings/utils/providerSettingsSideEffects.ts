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
