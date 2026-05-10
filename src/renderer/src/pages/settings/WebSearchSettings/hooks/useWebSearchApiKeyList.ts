import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ApiKeyValidity,
  normalizeWebSearchApiKeys,
  removeWebSearchApiKey,
  replaceWebSearchApiKey,
  validateWebSearchApiKey
} from '../utils/webSearchApiKeys'

type PendingApiKey = {
  id: string
}

export type WebSearchApiKeyListItem = {
  id: string
  key: string
  index: number
  isNew: boolean
}

export function useWebSearchApiKeyList(providerId: WebSearchProviderId) {
  const { getProvider, updateProvider } = useWebSearchProviders()
  const { t } = useTranslation()
  const [pendingNewKey, setPendingNewKey] = useState<PendingApiKey | null>(null)
  const provider = getProvider(providerId)
  const keys = useMemo(() => normalizeWebSearchApiKeys(provider?.apiKeys ?? []), [provider?.apiKeys])

  const updateKeys = useCallback(
    (nextKeys: string[]) => {
      if (!provider) {
        return
      }

      void updateProvider(provider.id, { apiKeys: normalizeWebSearchApiKeys(nextKeys) })
    },
    [provider, updateProvider]
  )

  const addPendingKey = useCallback(() => {
    setPendingNewKey((current) => current ?? { id: Date.now().toString() })
  }, [])

  const addKey = useCallback(
    (key: string): ApiKeyValidity => {
      const result = validateWebSearchApiKey(
        key,
        keys,
        t('settings.provider.api.key.error.empty'),
        t('settings.provider.api.key.error.duplicate')
      )

      if (!result.isValid) {
        return result
      }

      updateKeys([...keys, key])
      setPendingNewKey(null)
      return { isValid: true }
    },
    [keys, t, updateKeys]
  )

  const updateKey = useCallback(
    (index: number, key: string): ApiKeyValidity => {
      const otherKeys = keys.filter((_, itemIndex) => itemIndex !== index)
      const result = validateWebSearchApiKey(
        key,
        otherKeys,
        t('settings.provider.api.key.error.empty'),
        t('settings.provider.api.key.error.duplicate')
      )

      if (!result.isValid) {
        return result
      }

      const nextKeys = replaceWebSearchApiKey(keys, index, key)
      if (!nextKeys) {
        return { isValid: false, error: t('error.diagnosis.unknown') }
      }

      updateKeys(nextKeys)
      return { isValid: true }
    },
    [keys, t, updateKeys]
  )

  const removeKey = useCallback(
    (index: number) => {
      const nextKeys = removeWebSearchApiKey(keys, index)
      if (nextKeys) {
        updateKeys(nextKeys)
      }
    },
    [keys, updateKeys]
  )

  const updateListItem = useCallback(
    (item: WebSearchApiKeyListItem, key: string): ApiKeyValidity => {
      return item.isNew ? addKey(key) : updateKey(item.index, key)
    },
    [addKey, updateKey]
  )

  const removeListItem = useCallback(
    (item: WebSearchApiKeyListItem) => {
      if (item.isNew) {
        setPendingNewKey(null)
        return
      }

      removeKey(item.index)
    },
    [removeKey]
  )

  const displayItems = useMemo<WebSearchApiKeyListItem[]>(() => {
    const savedItems = keys.map((key, index) => ({
      id: `saved-${index}-${key}`,
      key,
      index,
      isNew: false
    }))

    if (!pendingNewKey) {
      return savedItems
    }

    return [
      ...savedItems,
      {
        id: pendingNewKey.id,
        key: '',
        index: keys.length,
        isNew: true
      }
    ]
  }, [keys, pendingNewKey])

  return {
    provider,
    keys,
    displayItems,
    hasPendingNewKey: Boolean(pendingNewKey),
    addPendingKey,
    updateListItem,
    removeListItem
  }
}
