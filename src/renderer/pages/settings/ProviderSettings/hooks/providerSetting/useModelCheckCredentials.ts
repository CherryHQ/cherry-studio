import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useProviderApiKeys, useProviderById } from '@renderer/hooks/useProvider'
import type {
  ModelCheckCredential,
  ModelCheckKeySelection
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import {
  getModelCheckCredentialPolicy,
  resolveModelCheckCredentials
} from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import type { ApiKeyEntry } from '@shared/data/types/provider'

import type { ApiKeysData } from './types'
import { useAuthenticationApiKey } from './useAuthenticationApiKey'
import { useProviderMeta } from './useProviderMeta'

function getRefetchedApiKeyEntries(value: unknown, fallback: readonly ApiKeyEntry[]): readonly ApiKeyEntry[] {
  if (typeof value !== 'object' || value === null || !('keys' in value) || !Array.isArray(value.keys)) {
    return fallback
  }

  return (value as ApiKeysData).keys
}

function createCredentialFingerprint(entries: readonly ApiKeyEntry[]) {
  return JSON.stringify(entries.map(({ id, key, label }) => ({ id, key, label: label ?? '' })))
}

export interface ModelCheckCredentialsState {
  apiKeyEntries: readonly ApiKeyEntry[]
  canSelectApiKey: boolean
  requiresApiKey: boolean
  credentialChangeVersion: number
  prepareCredentials: (selection: ModelCheckKeySelection, signal: AbortSignal) => Promise<ModelCheckCredential[]>
}

export class ModelCheckCredentialsSaveError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('Failed to save model check credentials')
    this.name = 'ModelCheckCredentialsSaveError'
    this.cause = cause
  }
}

/** Owns credential preparation and invalidation shared by provider model checks. */
export function useModelCheckCredentials(providerId: string): ModelCheckCredentialsState {
  const { provider } = useProviderById(providerId)
  const { data: apiKeysData, refetch: refetchApiKeys } = useProviderApiKeys(providerId)
  const { commitInputApiKeyNow, hasPendingSync, inputApiKey } = useAuthenticationApiKey()
  const { isApiKeyFieldVisible } = useProviderMeta(providerId)
  const apiKeyEntries = useMemo(() => apiKeysData?.keys ?? [], [apiKeysData?.keys])
  const { canSelectApiKey, requiresApiKey } = getModelCheckCredentialPolicy(provider, isApiKeyFieldVisible)
  const credentialFingerprint = useMemo(() => createCredentialFingerprint(apiKeyEntries), [apiKeyEntries])
  const [credentialChangeVersion, setCredentialChangeVersion] = useState(0)
  const preparingCredentialsRef = useRef(false)
  const acceptedCredentialFingerprintRef = useRef<string | null>(null)
  const previousCredentialFingerprintRef = useRef(credentialFingerprint)

  const prepareCredentials = useCallback(
    async (selection: ModelCheckKeySelection, signal: AbortSignal) => {
      preparingCredentialsRef.current = true
      try {
        try {
          await commitInputApiKeyNow()
        } catch (error) {
          throw new ModelCheckCredentialsSaveError(error)
        }
        signal.throwIfAborted()

        const refetched = await refetchApiKeys()
        signal.throwIfAborted()

        const latestEntries = getRefetchedApiKeyEntries(refetched, apiKeyEntries)
        acceptedCredentialFingerprintRef.current = createCredentialFingerprint(latestEntries)
        return resolveModelCheckCredentials(latestEntries, selection, { canSelectApiKey, requiresApiKey })
      } finally {
        preparingCredentialsRef.current = false
      }
    },
    [apiKeyEntries, canSelectApiKey, commitInputApiKeyNow, refetchApiKeys, requiresApiKey]
  )

  useEffect(() => {
    if (!hasPendingSync) return
    setCredentialChangeVersion((current) => current + 1)
  }, [hasPendingSync, inputApiKey])

  useEffect(() => {
    if (previousCredentialFingerprintRef.current === credentialFingerprint) return
    previousCredentialFingerprintRef.current = credentialFingerprint

    if (preparingCredentialsRef.current) {
      acceptedCredentialFingerprintRef.current = credentialFingerprint
      return
    }
    if (acceptedCredentialFingerprintRef.current === credentialFingerprint) {
      acceptedCredentialFingerprintRef.current = null
      return
    }

    setCredentialChangeVersion((current) => current + 1)
  }, [credentialFingerprint])

  return useMemo(
    () => ({
      apiKeyEntries,
      canSelectApiKey,
      requiresApiKey,
      credentialChangeVersion,
      prepareCredentials
    }),
    [apiKeyEntries, canSelectApiKey, credentialChangeVersion, prepareCredentials, requiresApiKey]
  )
}
