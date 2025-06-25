import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import SelectProviderModelPopup from '@renderer/pages/settings/ProviderSettings/SelectProviderModelPopup'
import { checkApi } from '@renderer/services/ApiService'
import WebSearchService from '@renderer/services/WebSearchService'
import { Model, Provider, WebSearchProvider } from '@renderer/types'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { isEmpty } from 'lodash'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiKeyStatus, ApiKeyValidationResult } from './types'

/**
 * API key 错误信息映射
 */
export const API_KEY_ERROR_MESSAGES = {
  empty_key: 'settings.provider.api.key.new_key.placeholder',
  duplicate_key: 'settings.provider.api.key.warn.key_already_exist',
  invalid_format: 'settings.provider.invalid_key'
} as const

interface UseApiKeysParams {
  provider: Provider | WebSearchProvider
  apiKeys: string
  onChange: (keys: string) => void
  type?: 'provider' | 'websearch'
}

interface UseApiKeysReturn {
  keys: ApiKeyStatus[]
  addKey: (key: string) => { success: boolean; error?: string }
  updateKey: (index: number, key: string) => { success: boolean; error?: string }
  removeKey: (index: number) => void
  removeInvalid: () => void
  checkKey: (index: number, selectedModel?: Model) => Promise<void>
  checkAllKeys: () => Promise<void>
  isChecking: boolean
}

export const useApiKeys = ({ provider, apiKeys, onChange, type = 'provider' }: UseApiKeysParams): UseApiKeysReturn => {
  const [keyStatuses, setKeyStatuses] = useState<ApiKeyStatus[]>(() => parseApiKeysToStatusArray(apiKeys))
  const { t } = useTranslation()

  // 同步外部apiKeys到内部状态
  useEffect(() => {
    const newKeyStatuses = parseApiKeysToStatusArray(apiKeys)

    setKeyStatuses((currentStatuses) => {
      const newKeys = newKeyStatuses.map((k) => k.key)
      const currentKeys = currentStatuses.map((k) => k.key)

      // 如果keys相同，保持当前状态以避免重新渲染
      if (newKeys.join(',') === currentKeys.join(',')) {
        return currentStatuses
      }

      // 合并新keys和现有状态
      const statusesMap = new Map(currentStatuses.map((s) => [s.key, s]))
      return newKeyStatuses.map((k) => statusesMap.get(k.key) || k)
    })
  }, [apiKeys])

  // 同步到父组件
  const syncToParent = useCallback(
    (statuses: ApiKeyStatus[]) => {
      onChange(statuses.map((status) => status.key).join(','))
    },
    [onChange]
  )

  // 添加新key
  const addKey = useCallback(
    (key: string) => {
      const validation = validateApiKey(
        key,
        keyStatuses.map((k) => k.key)
      )

      if (!validation.isValid) {
        showApiKeyError(validation.error!, t)
        return { success: false, error: validation.error }
      }

      const newStatuses = [...keyStatuses, { key: key.trim() }]
      setKeyStatuses(newStatuses)
      syncToParent(newStatuses)
      return { success: true }
    },
    [keyStatuses, syncToParent, t]
  )

  // 更新key
  const updateKey = useCallback(
    (index: number, key: string) => {
      const otherKeys = keyStatuses.filter((_, i) => i !== index).map((k) => k.key)
      const validation = validateApiKey(key, otherKeys)

      if (!validation.isValid) {
        showApiKeyError(validation.error!, t)
        return { success: false, error: validation.error }
      }

      const newStatuses = [...keyStatuses]
      newStatuses[index] = { ...newStatuses[index], key: key.trim(), isValid: undefined }
      setKeyStatuses(newStatuses)
      syncToParent(newStatuses)
      return { success: true }
    },
    [keyStatuses, syncToParent, t]
  )

  // 移除key
  const removeKey = useCallback(
    (index: number) => {
      const result = keyStatuses.filter((_, i) => i !== index)
      setKeyStatuses(result)
      syncToParent(result)
    },
    [keyStatuses, syncToParent]
  )

  // 移除无效keys
  const removeInvalid = useCallback(() => {
    const result = keyStatuses.filter((key) => key.isValid !== false)
    setKeyStatuses(result)
    syncToParent(result)
  }, [keyStatuses, syncToParent])

  // 获取用于检查的模型
  const getModelForCheck = useCallback(
    async (selectedModel?: Model): Promise<Model | null> => {
      if (type !== 'provider') return null

      const modelsToCheck = (provider as Provider).models.filter(
        (model) => !isEmbeddingModel(model) && !isRerankModel(model)
      )

      if (isEmpty(modelsToCheck)) {
        window.message.error({
          key: 'no-models',
          style: { marginTop: '3vh' },
          duration: 5,
          content: t('settings.provider.no_models_for_check')
        })
        return null
      }

      try {
        return (
          selectedModel ||
          (await SelectProviderModelPopup.show({
            provider: provider as Provider
          }))
        )
      } catch (err) {
        return null
      }
    },
    [type, provider, t]
  )

  // 检查单个key
  const checkKey = useCallback(
    async (keyIndex: number, selectedModel?: Model, isCheckingAll: boolean = false) => {
      if (keyStatuses[keyIndex].checking) {
        return
      }

      try {
        let latency: number
        let model: Model | undefined

        if (type === 'provider') {
          const selectedModelForCheck = await getModelForCheck(selectedModel)
          if (!selectedModelForCheck) return
          model = selectedModelForCheck

          setKeyStatuses((prev) =>
            prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: true } : status))
          )

          const startTime = Date.now()
          await checkApi({ ...(provider as Provider), apiKey: keyStatuses[keyIndex].key }, model)
          latency = Date.now() - startTime
        } else {
          setKeyStatuses((prev) =>
            prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: true } : status))
          )

          const startTime = Date.now()
          await WebSearchService.checkSearch({
            ...(provider as WebSearchProvider),
            apiKey: keyStatuses[keyIndex].key
          })
          latency = Date.now() - startTime
        }

        // 只在检查单个key时显示通知
        if (!isCheckingAll) {
          window.message.success({
            key: 'api-check',
            style: { marginTop: '3vh' },
            duration: 2,
            content: t('message.api.connection.success')
          })
        }

        setKeyStatuses((prev) =>
          prev.map((status, idx) =>
            idx === keyIndex
              ? {
                  ...status,
                  checking: false,
                  isValid: true,
                  model: selectedModel || model,
                  latency
                }
              : status
          )
        )
      } catch (error: any) {
        // 只在检查单个key时显示通知
        if (!isCheckingAll) {
          const errorMessage = error?.message ? ' ' + error.message : ''
          window.message.error({
            key: 'api-check',
            style: { marginTop: '3vh' },
            duration: 8,
            content: t('message.api.connection.failed') + errorMessage
          })
        }

        setKeyStatuses((prev) =>
          prev.map((status, idx) =>
            idx === keyIndex
              ? {
                  ...status,
                  checking: false,
                  isValid: false,
                  error: error instanceof Error ? error.message : String(error)
                }
              : status
          )
        )
      }
    },
    [keyStatuses, type, getModelForCheck, provider, t]
  )

  // 检查所有keys
  const checkAllKeys = useCallback(async () => {
    let selectedModel
    if (type === 'provider') {
      selectedModel = await getModelForCheck()
      if (!selectedModel) {
        return
      }
    }

    await Promise.all(keyStatuses.map((_, index) => checkKey(index, selectedModel, true)))
  }, [keyStatuses, type, getModelForCheck, checkKey])

  return {
    keys: keyStatuses,
    addKey,
    updateKey,
    removeKey,
    removeInvalid,
    checkKey,
    checkAllKeys,
    isChecking: keyStatuses.some((k) => k.checking)
  }
}

/**
 * 验证单个 API key 的有效性
 */
function validateApiKey(key: string, existingKeys: string[] = []): ApiKeyValidationResult {
  const trimmedKey = key.trim()

  if (!trimmedKey) {
    return { isValid: false, error: 'empty_key' }
  }

  if (trimmedKey.includes(',')) {
    return { isValid: false, error: 'invalid_format' }
  }

  if (existingKeys.includes(trimmedKey)) {
    return { isValid: false, error: 'duplicate_key' }
  }

  return { isValid: true }
}

/**
 * 将 API key 字符串转换为状态对象数组
 */
function parseApiKeysToStatusArray(apiKeys: string): ApiKeyStatus[] {
  if (!apiKeys) return []

  const formattedApiKeys = formatApiKeys(apiKeys)

  if (formattedApiKeys.includes(',')) {
    const keys = splitApiKeyString(formattedApiKeys)
    const uniqueKeys = [...new Set(keys)]
    return uniqueKeys.map((key) => ({ key }))
  } else {
    return formattedApiKeys ? [{ key: formattedApiKeys }] : []
  }
}

/**
 * 显示 API key 相关错误消息
 */
function showApiKeyError(error: keyof typeof API_KEY_ERROR_MESSAGES, t: (key: string) => string): void {
  window.message.error({
    key: `api-key-${error}`,
    style: { marginTop: '3vh' },
    duration: 3,
    content: t(API_KEY_ERROR_MESSAGES[error])
  })
}
