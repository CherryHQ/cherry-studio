import { loggerService } from '@logger'
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

const logger = loggerService.withContext('useWebSearchApiKeyList')

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
  const { getProvider, setApiKeys } = useWebSearchProviders()
  const { t } = useTranslation()
  const [pendingNewKey, setPendingNewKey] = useState<PendingApiKey | null>(null)
  const provider = getProvider(providerId)
  const keys = useMemo(() => normalizeWebSearchApiKeys(provider?.apiKeys ?? []), [provider?.apiKeys])

  const updateKeys = useCallback(
    async (nextKeys: string[]) => {
      if (!provider) {
        return
      }

      await setApiKeys(provider.id, normalizeWebSearchApiKeys(nextKeys))
    },
    [provider, setApiKeys]
  )

  const addPendingKey = useCallback(() => {
    setPendingNewKey((current) => current ?? { id: Date.now().toString() })
  }, [])

  const addKey = useCallback(
    async (key: string): Promise<ApiKeyValidity> => {
      const result = validateWebSearchApiKey(
        key,
        keys,
        t('settings.provider.api.key.error.empty'),
        t('settings.provider.api.key.error.duplicate')
      )

      if (!result.isValid) {
        return result
      }

      await updateKeys([...keys, key])
      setPendingNewKey(null)
      return { isValid: true }
    },
    [keys, t, updateKeys]
  )

  const updateKey = useCallback(
    async (index: number, key: string): Promise<ApiKeyValidity> => {
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
        logger.error('Invalid web search API key index', { index, length: keys.length })
        return { isValid: false, error: t('error.diagnosis.unknown') }
      }

      await updateKeys(nextKeys)
      return { isValid: true }
    },
    [keys, t, updateKeys]
  )

  const removeKey = useCallback(
    async (index: number) => {
      const nextKeys = removeWebSearchApiKey(keys, index)
      if (!nextKeys) {
        logger.error('Invalid web search API key index', { index, length: keys.length })
        return
      }

      await updateKeys(nextKeys)
    },
    [keys, updateKeys]
  )

  const updateListItem = useCallback(
    (item: WebSearchApiKeyListItem, key: string): Promise<ApiKeyValidity> => {
      return item.isNew ? addKey(key) : updateKey(item.index, key)
    },
    [addKey, updateKey]
  )

  const removeListItem = useCallback(
    async (item: WebSearchApiKeyListItem) => {
      if (item.isNew) {
        setPendingNewKey(null)
        return
      }

      await removeKey(item.index)
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
