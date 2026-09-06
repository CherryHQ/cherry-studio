import { loggerService } from '@logger'
import { useProviderMutations } from '@renderer/hooks/useProvider'
import { useModelCheckCredentials } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useModelCheckCredentials'
import { useProviderConnectionCheck } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderConnectionCheck'
import type {
  ModelCheckKeySelection,
  ModelWithStatus
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useHealthCheck } from './useHealthCheck'

const logger = loggerService.withContext('ProviderSettings:ModelCheckContext')

interface ModelListHealthRunContextValue {
  providerId: string
  models: readonly Model[]
  apiKeyEntries: readonly ApiKeyEntry[]
  canSelectApiKey: boolean
  requiresApiKey: boolean
  modelCheckOpen: boolean
  isHealthChecking: boolean
  isSingleModelChecking: boolean
  isModelChecking: boolean
  singleModelResult: ModelWithStatus | null
  savingKeyId: string | null
  openModelCheck: () => void
  closeModelCheck: () => void
  resetSingleModelResult: () => void
  startSingleModelCheck: (config: {
    model: Model
    keySelection: ModelCheckKeySelection
  }) => Promise<'passed' | 'failed'>
  startHealthCheck: (config: {
    keySelection: ModelCheckKeySelection
    isConcurrent: boolean
    timeout: number
  }) => Promise<boolean>
  toggleApiKey: (keyId: string, enabled: boolean) => Promise<void>
}

const ModelListHealthRunContext = createContext<ModelListHealthRunContextValue | null>(null)

export function ModelListHealthProvider({ providerId, children }: { providerId: string; children: ReactNode }) {
  const { t } = useTranslation()
  const credentials = useModelCheckCredentials(providerId)
  const single = useProviderConnectionCheck(providerId, credentials)
  const all = useHealthCheck(providerId, credentials)
  const isHealthChecking = all.isChecking
  const runAllModels = all.startHealthCheck
  const runSingleModel = single.startSingleModelCheck
  const isSingleModelChecking = single.isSingleModelChecking
  const resetSingleModelResult = single.resetSingleModelResult
  const { updateApiKey } = useProviderMutations(providerId)
  const [modelCheckOpen, setModelCheckOpen] = useState(false)
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null)
  const isModelChecking = isSingleModelChecking || isHealthChecking

  const openModelCheck = useCallback(() => {
    resetSingleModelResult()
    setModelCheckOpen(true)
  }, [resetSingleModelResult])
  const closeModelCheck = useCallback(() => setModelCheckOpen(false), [])

  const startSingleModelCheck = useCallback(
    async (config: { model: Model; keySelection: ModelCheckKeySelection }) => {
      if (isHealthChecking || isSingleModelChecking) return 'failed' as const
      const outcome = await runSingleModel(config)
      if (outcome === 'passed') setModelCheckOpen(false)
      return outcome
    },
    [isHealthChecking, isSingleModelChecking, runSingleModel]
  )

  const startHealthCheck = useCallback(
    async (config: { keySelection: ModelCheckKeySelection; isConcurrent: boolean; timeout: number }) => {
      if (isHealthChecking || isSingleModelChecking) return false
      const started = await runAllModels(config)
      if (started) setModelCheckOpen(false)
      return started
    },
    [isHealthChecking, isSingleModelChecking, runAllModels]
  )

  const toggleApiKey = useCallback(
    async (keyId: string, enabled: boolean) => {
      if (savingKeyId) return
      setSavingKeyId(keyId)
      try {
        await updateApiKey(keyId, { isEnabled: enabled })
      } catch (error) {
        logger.error('Failed to update API key from model check result', { providerId, keyId, error })
        toast.error(t('settings.provider.api_key.save_failed'))
        throw error
      } finally {
        setSavingKeyId(null)
      }
    },
    [providerId, savingKeyId, t, updateApiKey]
  )

  const runValue = useMemo<ModelListHealthRunContextValue>(
    () => ({
      providerId,
      models: single.models,
      apiKeyEntries: credentials.apiKeyEntries,
      canSelectApiKey: credentials.canSelectApiKey,
      requiresApiKey: credentials.requiresApiKey,
      modelCheckOpen,
      isHealthChecking,
      isSingleModelChecking,
      isModelChecking,
      singleModelResult: single.singleModelResult,
      savingKeyId,
      openModelCheck,
      closeModelCheck,
      resetSingleModelResult,
      startSingleModelCheck,
      startHealthCheck,
      toggleApiKey
    }),
    [
      credentials.apiKeyEntries,
      credentials.canSelectApiKey,
      credentials.requiresApiKey,
      isHealthChecking,
      closeModelCheck,
      isModelChecking,
      modelCheckOpen,
      openModelCheck,
      providerId,
      savingKeyId,
      isSingleModelChecking,
      single.models,
      resetSingleModelResult,
      single.singleModelResult,
      startHealthCheck,
      startSingleModelCheck,
      toggleApiKey
    ]
  )
  return <ModelListHealthRunContext value={runValue}>{children}</ModelListHealthRunContext>
}

export function useModelListHealthRun() {
  const context = use(ModelListHealthRunContext)
  if (!context) throw new Error('useModelListHealthRun must be used within ModelListHealthProvider')
  return context
}
