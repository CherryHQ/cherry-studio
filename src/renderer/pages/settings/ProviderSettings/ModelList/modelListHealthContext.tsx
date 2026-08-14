import { loggerService } from '@logger'
import { useProviderMutations } from '@renderer/hooks/useProvider'
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
  resetHealthCheckRun: () => void
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

interface ModelListHealthResultsContextValue {
  modelStatusMap: Map<string, ModelWithStatus>
  modelStatuses: ModelWithStatus[]
}

const ModelListHealthRunContext = createContext<ModelListHealthRunContextValue | null>(null)
const ModelListHealthResultsContext = createContext<ModelListHealthResultsContextValue | null>(null)

export function ModelListHealthProvider({ providerId, children }: { providerId: string; children: ReactNode }) {
  const { t } = useTranslation()
  const single = useProviderConnectionCheck(providerId)
  const all = useHealthCheck(providerId)
  const isHealthChecking = all.isChecking
  const runAllModels = all.startHealthCheck
  const runSingleModel = single.startSingleModelCheck
  const isSingleModelChecking = single.isSingleModelChecking
  const { updateApiKey } = useProviderMutations(providerId)
  const [modelCheckOpen, setModelCheckOpen] = useState(false)
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null)
  const isModelChecking = isSingleModelChecking || isHealthChecking

  const openModelCheck = useCallback(() => setModelCheckOpen(true), [])
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
      apiKeyEntries: single.apiKeyEntries,
      requiresApiKey: single.requiresApiKey,
      modelCheckOpen,
      isHealthChecking,
      isSingleModelChecking,
      isModelChecking,
      singleModelResult: single.singleModelResult,
      savingKeyId,
      openModelCheck,
      closeModelCheck,
      resetSingleModelResult: single.resetSingleModelResult,
      resetHealthCheckRun: all.resetHealthCheckRun,
      startSingleModelCheck,
      startHealthCheck,
      toggleApiKey
    }),
    [
      isHealthChecking,
      all.resetHealthCheckRun,
      closeModelCheck,
      isModelChecking,
      modelCheckOpen,
      openModelCheck,
      providerId,
      savingKeyId,
      single.apiKeyEntries,
      isSingleModelChecking,
      single.models,
      single.requiresApiKey,
      single.resetSingleModelResult,
      single.singleModelResult,
      startHealthCheck,
      startSingleModelCheck,
      toggleApiKey
    ]
  )
  const resultsValue = useMemo(
    () => ({
      modelStatusMap: new Map(all.modelStatuses.map((status) => [status.model.id, status])),
      modelStatuses: all.modelStatuses
    }),
    [all.modelStatuses]
  )

  return (
    <ModelListHealthRunContext value={runValue}>
      <ModelListHealthResultsContext value={resultsValue}>{children}</ModelListHealthResultsContext>
    </ModelListHealthRunContext>
  )
}

export function useModelListHealthRun() {
  const context = use(ModelListHealthRunContext)
  if (!context) throw new Error('useModelListHealthRun must be used within ModelListHealthProvider')
  return context
}

export function useModelListHealthResults() {
  const context = use(ModelListHealthResultsContext)
  if (!context) throw new Error('useModelListHealthResults must be used within ModelListHealthProvider')
  return context
}

export function useModelListHealth() {
  return { ...useModelListHealthRun(), ...useModelListHealthResults() }
}
