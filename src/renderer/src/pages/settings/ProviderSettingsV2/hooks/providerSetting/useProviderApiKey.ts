import { loggerService } from '@logger'
import { useProvider, useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProviders'
import i18n from '@renderer/i18n'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { debounce } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ApiKeysData } from './types'

const logger = loggerService.withContext('useProviderApiKey')

export interface ApiKeyValue {
  serverApiKey: string
  inputApiKey: string
  hasPendingSync: boolean
}

export interface ApiKeyState extends ApiKeyValue {
  setInputApiKey: (value: string) => void
  commitInputApiKeyNow: () => Promise<void>
}

function getEnabledApiKeyString(apiKeysData: ApiKeysData | undefined) {
  return (
    apiKeysData?.keys
      ?.filter((item) => item.isEnabled)
      .map((item) => item.key)
      .join(',') ?? ''
  )
}

function parseApiKeys(value: string) {
  const seenKeys = new Set<string>()

  return splitApiKeyString(formatApiKeys(value)).filter((key) => {
    if (seenKeys.has(key)) {
      return false
    }

    seenKeys.add(key)
    return true
  })
}

function toEnabledApiKeyString(value: string) {
  return parseApiKeys(value).join(',')
}

function toApiKeyEntries(value: string, apiKeysData: ApiKeysData | undefined): ApiKeyEntry[] {
  const nextEnabledKeys = parseApiKeys(value)
  const existingKeys = apiKeysData?.keys ?? []
  const existingEnabledKeys = existingKeys.filter((item) => item.isEnabled)
  const usedEntryIds = new Set<string>()
  const nextEntries: ApiKeyEntry[] = []
  let enabledCursor = 0

  for (const key of nextEnabledKeys) {
    const matchedEntry = existingKeys.find((item) => !usedEntryIds.has(item.id) && item.key.trim() === key)

    if (matchedEntry) {
      usedEntryIds.add(matchedEntry.id)
      nextEntries.push({ ...matchedEntry, key, isEnabled: true })
      continue
    }

    while (enabledCursor < existingEnabledKeys.length && usedEntryIds.has(existingEnabledKeys[enabledCursor].id)) {
      enabledCursor += 1
    }

    const reusableEnabledEntry = existingEnabledKeys[enabledCursor]
    if (reusableEnabledEntry) {
      usedEntryIds.add(reusableEnabledEntry.id)
      nextEntries.push({ ...reusableEnabledEntry, key, isEnabled: true })
      enabledCursor += 1
      continue
    }

    nextEntries.push({ id: crypto.randomUUID(), key, isEnabled: true })
  }

  const untouchedDisabledEntries = existingKeys.filter((item) => !item.isEnabled && !usedEntryIds.has(item.id))
  return [...nextEntries, ...untouchedDisabledEntries]
}

function createApiKeyValue(serverApiKey: string): ApiKeyValue {
  return {
    serverApiKey,
    inputApiKey: serverApiKey,
    hasPendingSync: false
  }
}

function isSameApiKeyValue(left: ApiKeyValue, right: ApiKeyValue) {
  return (
    left.serverApiKey === right.serverApiKey &&
    left.inputApiKey === right.inputApiKey &&
    left.hasPendingSync === right.hasPendingSync
  )
}

function syncApiKeyValueFromServer(value: ApiKeyValue, serverApiKey: string): ApiKeyValue {
  if (!value.hasPendingSync) {
    return createApiKeyValue(serverApiKey)
  }

  const normalizedInputApiKey = toEnabledApiKeyString(value.inputApiKey)
  if (normalizedInputApiKey === serverApiKey) {
    return createApiKeyValue(serverApiKey)
  }

  return {
    ...value,
    serverApiKey,
    hasPendingSync: true
  }
}

/**
 * Intent: create one API key state owner for one AuthenticationSection instance and wire it to provider settings sync.
 * Scope: use only at the auth-section owner boundary, then pass the state through a narrow local provider.
 * Does not handle: popup orchestration, connection checks, or endpoint ownership.
 */
export function useProviderApiKey(providerId: string) {
  const { provider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { updateApiKeys } = useProviderMutations(providerId)

  const serverApiKey = useMemo(() => getEnabledApiKeyString(apiKeysData), [apiKeysData])
  const [value, setValue] = useState<ApiKeyValue>(() => createApiKeyValue(serverApiKey))
  const previousProviderIdRef = useRef(providerId)
  const valueRef = useRef(value)
  const saveApiKeyRef = useRef<(value: string) => Promise<void>>(async () => undefined)

  const saveApiKey = useCallback(
    async (value: string) => {
      if (!provider) {
        return
      }

      await updateApiKeys(toApiKeyEntries(value, apiKeysData))
    },
    [apiKeysData, provider, updateApiKeys]
  )

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    saveApiKeyRef.current = saveApiKey
  }, [saveApiKey])

  const saveLater = useMemo(
    () =>
      debounce((nextValue: string) => {
        void saveApiKeyRef.current(nextValue).catch((error) => {
          logger.error('Failed to save API keys', error as Error)
          window.toast.error(i18n.t('settings.provider.api_key.save_failed'))
          setValue((current) => ({ ...current, hasPendingSync: true }))
        })
      }, 150),
    []
  )

  useEffect(() => {
    const providerChanged = previousProviderIdRef.current !== providerId
    previousProviderIdRef.current = providerId

    const nextValue = providerChanged
      ? createApiKeyValue(serverApiKey)
      : syncApiKeyValueFromServer(valueRef.current, serverApiKey)

    if (!nextValue.hasPendingSync) {
      saveLater.cancel()
    }

    setValue((previousValue) => (isSameApiKeyValue(previousValue, nextValue) ? previousValue : nextValue))
  }, [providerId, saveLater, serverApiKey])

  useEffect(() => () => saveLater.cancel(), [saveLater])

  const setInputApiKey = useCallback(
    (nextInputApiKey: string) => {
      const normalizedInputApiKey = toEnabledApiKeyString(nextInputApiKey)
      const hasPendingSync = normalizedInputApiKey !== valueRef.current.serverApiKey

      setValue((previousValue) => {
        const nextValue = {
          ...previousValue,
          inputApiKey: nextInputApiKey,
          hasPendingSync
        }

        return isSameApiKeyValue(previousValue, nextValue) ? previousValue : nextValue
      })

      if (hasPendingSync) {
        saveLater(normalizedInputApiKey)
        return
      }

      saveLater.cancel()
    },
    [saveLater]
  )

  const commitInputApiKeyNow = useCallback(async () => {
    saveLater.cancel()

    const currentValue = valueRef.current
    const normalizedInputApiKey = toEnabledApiKeyString(currentValue.inputApiKey)
    if (normalizedInputApiKey === currentValue.serverApiKey) {
      return
    }

    await saveApiKeyRef.current(normalizedInputApiKey)
  }, [saveLater])

  return useMemo(
    () => ({
      ...value,
      setInputApiKey,
      commitInputApiKeyNow
    }),
    [commitInputApiKeyNow, setInputApiKey, value]
  )
}
