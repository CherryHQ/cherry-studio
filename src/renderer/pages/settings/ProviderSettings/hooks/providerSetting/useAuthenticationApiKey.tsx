import { createContext, use } from 'react'

import type { ApiKeyState } from './useProviderApiKey'

const ApiKeyContext = createContext<ApiKeyState | null>(null)

export const ApiKeyProvider = ApiKeyContext.Provider

export function useAuthenticationApiKey() {
  const value = use(ApiKeyContext)

  if (!value) {
    throw new Error('useAuthenticationApiKey must be used within AuthenticationSection')
  }

  return value
}
