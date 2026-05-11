import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ApiKeyValidity,
  normalizeFileProcessingApiKeys,
  removeFileProcessingApiKey,
  replaceFileProcessingApiKey,
  validateFileProcessingApiKey
} from '../utils/fileProcessingApiKeys'

type PendingApiKey = {
  id: string
}

export type FileProcessingApiKeyListItem = {
  id: string
  key: string
  index: number
  isNew: boolean
}

type UseFileProcessingApiKeyListOptions = {
  processorId: FileProcessorId
  apiKeys: string[]
  onSetApiKeys: (processorId: FileProcessorId, apiKeys: string[]) => Promise<void>
}

export function useFileProcessingApiKeyList({
  processorId,
  apiKeys,
  onSetApiKeys
}: UseFileProcessingApiKeyListOptions) {
  const { t } = useTranslation()
  const [pendingNewKey, setPendingNewKey] = useState<PendingApiKey | null>(null)
  const keys = useMemo(() => normalizeFileProcessingApiKeys(apiKeys), [apiKeys])

  const updateKeys = useCallback(
    async (nextKeys: string[]) => {
      const normalizedKeys = normalizeFileProcessingApiKeys(nextKeys)
      await onSetApiKeys(processorId, normalizedKeys)
    },
    [onSetApiKeys, processorId]
  )

  const addPendingKey = useCallback(() => {
    setPendingNewKey((current) => current ?? { id: Date.now().toString() })
  }, [])

  const addKey = useCallback(
    async (key: string): Promise<ApiKeyValidity> => {
      const result = validateFileProcessingApiKey(
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
      const result = validateFileProcessingApiKey(
        key,
        otherKeys,
        t('settings.provider.api.key.error.empty'),
        t('settings.provider.api.key.error.duplicate')
      )

      if (!result.isValid) {
        return result
      }

      const nextKeys = replaceFileProcessingApiKey(keys, index, key)
      if (!nextKeys) {
        return { isValid: false, error: 'Invalid index' }
      }

      await updateKeys(nextKeys)
      return { isValid: true }
    },
    [keys, t, updateKeys]
  )

  const removeKey = useCallback(
    async (index: number) => {
      const nextKeys = removeFileProcessingApiKey(keys, index)
      if (nextKeys) {
        await updateKeys(nextKeys)
      }
    },
    [keys, updateKeys]
  )

  const updateListItem = useCallback(
    (item: FileProcessingApiKeyListItem, key: string): Promise<ApiKeyValidity> => {
      return item.isNew ? addKey(key) : updateKey(item.index, key)
    },
    [addKey, updateKey]
  )

  const removeListItem = useCallback(
    async (item: FileProcessingApiKeyListItem) => {
      if (item.isNew) {
        setPendingNewKey(null)
        return
      }

      await removeKey(item.index)
    },
    [removeKey]
  )

  const displayItems = useMemo<FileProcessingApiKeyListItem[]>(() => {
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
    keys,
    displayItems,
    hasPendingNewKey: Boolean(pendingNewKey),
    addPendingKey,
    updateListItem,
    removeListItem
  }
}
