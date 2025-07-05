import Logger from '@renderer/config/logger'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import SelectProviderModelPopup from '@renderer/pages/settings/ProviderSettings/SelectProviderModelPopup'
import { checkApi } from '@renderer/services/ApiService'
import WebSearchService from '@renderer/services/WebSearchService'
import { Model, PreprocessProvider, Provider, WebSearchProvider } from '@renderer/types'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { formatErrorMessage } from '@renderer/utils/error'
import { TFunction } from 'i18next'
import { isEmpty } from 'lodash'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiKeyConnectivity, ApiKeyValidity, ApiKeyWithStatus, ApiProviderKind, ApiProviderUnion } from './types'

interface UseApiKeysProps {
  provider: ApiProviderUnion
  updateProvider: (provider: Partial<ApiProviderUnion>) => void
  providerKind: ApiProviderKind
}

/**
 * API Keys 管理 hook
 */
export function useApiKeys({ provider, updateProvider, providerKind }: UseApiKeysProps) {
  const { t } = useTranslation()

  // 连通性检查的 UI 状态管理
  const [connectivityStates, setConnectivityStates] = useState<Map<string, ApiKeyConnectivity>>(new Map())

  // 保存 apiKey 到 provider
  const updateProviderWithKey = useCallback(
    (newKeys: string[]) => {
      const validKeys = newKeys.filter((k) => k.trim())
      const formattedKeyString = formatApiKeys(validKeys.join(','))
      updateProvider({ apiKey: formattedKeyString })
    },
    [updateProvider]
  )

  // 解析 keyString 为数组
  const keys = useMemo(() => {
    if (!provider.apiKey) return []
    const formattedApiKeys = formatApiKeys(provider.apiKey)
    const keys = splitApiKeyString(formattedApiKeys)
    return Array.from(new Set(keys))
  }, [provider.apiKey])

  // 合并基本数据和连通性状态
  const keysWithStatus = useMemo((): ApiKeyWithStatus[] => {
    return keys.map((key) => {
      const connectivityState = connectivityStates.get(key) || {
        status: 'not_checked' as const,
        checking: false,
        error: undefined,
        model: undefined,
        latency: undefined
      }
      return {
        key,
        ...connectivityState
      }
    })
  }, [keys, connectivityStates])

  // 更新单个 key 的连通性状态
  const updateConnectivityState = useCallback((key: string, state: Partial<ApiKeyConnectivity>) => {
    setConnectivityStates((prev) => {
      const newMap = new Map(prev)
      const currentState = prev.get(key) || {
        status: 'not_checked' as const,
        checking: false,
        error: undefined,
        model: undefined,
        latency: undefined
      }
      newMap.set(key, { ...currentState, ...state })
      return newMap
    })
  }, [])

  // 验证 API key 格式
  const validateApiKey = useCallback(
    (key: string, existingKeys: string[] = []): ApiKeyValidity => {
      const trimmedKey = key.trim()

      if (!trimmedKey) {
        return { isValid: false, error: t('settings.provider.api.key.error.empty') }
      }

      if (existingKeys.includes(trimmedKey)) {
        return { isValid: false, error: t('settings.provider.api.key.error.duplicate') }
      }

      return { isValid: true }
    },
    [t]
  )

  // 添加新 key
  const addKey = useCallback(
    (key: string): ApiKeyValidity => {
      const validation = validateApiKey(key, keys)

      if (!validation.isValid) {
        return validation
      }

      updateProviderWithKey([...keys, key.trim()])
      return { isValid: true }
    },
    [validateApiKey, keys, updateProviderWithKey]
  )

  // 更新 key
  const updateKey = useCallback(
    (index: number, key: string): ApiKeyValidity => {
      if (index < 0 || index >= keys.length) {
        Logger.error('[ApiKeyList] invalid key index', { index })
        return { isValid: false, error: 'Invalid index' }
      }

      const otherKeys = keys.filter((_, i) => i !== index)
      const validation = validateApiKey(key, otherKeys)

      if (!validation.isValid) {
        return validation
      }

      // 清除旧 key 的连通性状态
      const oldKey = keys[index]
      if (oldKey !== key.trim()) {
        setConnectivityStates((prev) => {
          const newMap = new Map(prev)
          newMap.delete(oldKey)
          return newMap
        })
      }

      const newKeys = [...keys]
      newKeys[index] = key.trim()
      updateProviderWithKey(newKeys)

      return { isValid: true }
    },
    [keys, validateApiKey, updateProviderWithKey]
  )

  // 移除 key
  const removeKey = useCallback(
    (index: number) => {
      if (index < 0 || index >= keys.length) return

      const keyToRemove = keys[index]
      const newKeys = keys.filter((_, i) => i !== index)

      // 清除对应的连通性状态
      setConnectivityStates((prev) => {
        const newMap = new Map(prev)
        newMap.delete(keyToRemove)
        return newMap
      })

      updateProviderWithKey(newKeys)
    },
    [keys, updateProviderWithKey]
  )

  // 移除连通性检查失败的 keys
  const removeInvalidKeys = useCallback(() => {
    const validKeys = keysWithStatus.filter((keyStatus) => keyStatus.status !== 'error').map((k) => k.key)

    // 清除被删除的 keys 的连通性状态
    const keysToRemove = keysWithStatus.filter((keyStatus) => keyStatus.status === 'error').map((k) => k.key)

    setConnectivityStates((prev) => {
      const newMap = new Map(prev)
      keysToRemove.forEach((key) => newMap.delete(key))
      return newMap
    })

    updateProviderWithKey(validKeys)
  }, [keysWithStatus, updateProviderWithKey])

  // 检查单个 key 的连通性，不负责选择和验证模型
  const runConnectivityCheck = useCallback(
    async (index: number, model?: Model): Promise<void> => {
      const keyToCheck = keys[index]
      const currentState = connectivityStates.get(keyToCheck)
      if (currentState?.checking) return

      // 设置检查状态
      updateConnectivityState(keyToCheck, { checking: true })

      try {
        const startTime = Date.now()
        if (isLlmProvider(provider, providerKind) && model) {
          await checkApi({ ...provider, apiKey: keyToCheck }, model)
        } else {
          const result = await WebSearchService.checkSearch({ ...provider, apiKey: keyToCheck })
          if (!result.valid) throw new Error(result.error)
        }
        const latency = Date.now() - startTime

        // 连通性检查成功
        updateConnectivityState(keyToCheck, {
          checking: false,
          status: 'success',
          model,
          latency,
          error: undefined
        })
      } catch (error: any) {
        // 连通性检查失败
        updateConnectivityState(keyToCheck, {
          checking: false,
          status: 'error',
          error: formatErrorMessage(error),
          model: undefined,
          latency: undefined
        })

        Logger.error('[ApiKeyList] failed to validate the connectivity of the api key', error)
      }
    },
    [keys, connectivityStates, updateConnectivityState, provider, providerKind]
  )

  // 检查单个 key 的连通性
  const checkKeyConnectivity = useCallback(
    async (index: number): Promise<void> => {
      if (!provider || index < 0 || index >= keys.length) return

      const keyToCheck = keys[index]
      const currentState = connectivityStates.get(keyToCheck)
      if (currentState?.checking) return

      const model = isLlmProvider(provider, providerKind) ? await getModelForCheck(provider, t) : undefined
      if (model === null) return

      await runConnectivityCheck(index, model)
    },
    [provider, keys, connectivityStates, providerKind, t, runConnectivityCheck]
  )

  // 检查所有 keys 的连通性
  const checkAllKeysConnectivity = useCallback(async () => {
    if (!provider || keys.length === 0) return

    const model = isLlmProvider(provider, providerKind) ? await getModelForCheck(provider, t) : undefined
    if (model === null) return

    await Promise.allSettled(keys.map((_, index) => runConnectivityCheck(index, model)))
  }, [provider, keys, providerKind, t, runConnectivityCheck])

  // 计算是否有 key 正在检查
  const isChecking = useMemo(() => {
    return Array.from(connectivityStates.values()).some((state) => state.checking)
  }, [connectivityStates])

  return {
    keys: keysWithStatus,
    addKey,
    updateKey,
    removeKey,
    removeInvalidKeys,
    checkKeyConnectivity,
    checkAllKeysConnectivity,
    isChecking
  }
}

export function isLlmProvider(obj: any, kind: ApiProviderKind): obj is Provider {
  return kind === 'llm' && 'type' in obj && 'models' in obj
}

export function isWebSearchProvider(obj: any, kind: ApiProviderKind): obj is WebSearchProvider {
  return kind === 'websearch' && ('url' in obj || 'engines' in obj)
}

export function isPreprocessProvider(obj: any, kind: ApiProviderKind): obj is PreprocessProvider {
  return kind === 'doc-preprocess' && ('quota' in obj || 'options' in obj)
}

// 获取模型用于检查
async function getModelForCheck(provider: Provider, t: TFunction): Promise<Model | null> {
  const modelsToCheck = provider.models.filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))

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
    const selectedModel = await SelectProviderModelPopup.show({ provider })
    if (!selectedModel) return null
    return selectedModel
  } catch (error) {
    Logger.error('[ApiKeyList] failed to select model', error)
    return null
  }
}
