# Cherry Studio - apply 'Remove failed models' feature
# Run this from the root of your cherry-studio checkout (C:\Users\ag\Desktop\cherry-studio)
$ErrorActionPreference = 'Stop'

Write-Host 'Writing src\renderer\pages\settings\ProviderSettings\ModelList\ProviderModelRemoveFailed.tsx'
$path = 'src\renderer\pages\settings\ProviderSettings\ModelList\ProviderModelRemoveFailed.tsx'
New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
@'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useModelMutations } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'

import { useModelListHealthRun } from './modelListHealthContext'

const logger = loggerService.withContext('ProviderSettings:RemoveFailed')

interface ProviderModelRemoveFailedProps {
  disabled?: boolean
}

export default function ProviderModelRemoveFailed({ disabled }: ProviderModelRemoveFailedProps) {
  const { t } = useTranslation()
  const health = useModelListHealthRun()
  const { deleteModels } = useModelMutations()

  const failedModels =
    health.lastCheckResults?.filter((result) => result.kind === 'failed').map((result) => result.model) ?? []

  if (failedModels.length === 0) return null

  const handleRemoveFailed = async () => {
    try {
      await deleteModels(failedModels.map((m) => m.id))
      toast.success(t('settings.models.check.remove_failed_success', { count: failedModels.length }))
    } catch (error) {
      logger.error('Failed to remove failed models', { count: failedModels.length, error })
      toast.error(t('settings.models.manage.operation_failed'))
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 rounded-lg border-border-subtle bg-background px-2.5 py-0 text-foreground text-sm leading-5 shadow-none hover:bg-accent/40 hover:text-foreground"
      disabled={disabled || health.isModelChecking}
      onClick={() => void handleRemoveFailed()}>
      {t('settings.models.check.remove_failed_button', { count: failedModels.length })}
    </Button>
  )
}
'@ | Set-Content -Path $path -Encoding UTF8 -NoNewline

Write-Host 'Writing src\renderer\pages\settings\ProviderSettings\ModelList\useHealthCheck.ts'
$path = 'src\renderer\pages\settings\ProviderSettings\ModelList\useHealthCheck.ts'
New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
@'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProviderById } from '@renderer/hooks/useProvider'
import i18n from '@renderer/i18n/resolver'
import {
  ModelCheckCredentialsSaveError,
  type ModelCheckCredentialsState
} from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useModelCheckCredentials'
import { useProviderEndpoints } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderEndpoints'
import type {
  ModelCheckCredential,
  ModelCheckKeySelection,
  ModelWithStatus
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import {
  getModelHealthCheckSkipReason,
  ModelCheckCredentialsError,
  summarizeHealthResults
} from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import { checkModelsHealth } from './checkModelsHealth'
import { clearModelHealthStatus, writeModelHealthStatus } from './modelHealthStatusCache'

const logger = loggerService.withContext('ProviderSettings:ModelCheck')

function createModelCheckFingerprint(model: Model) {
  return JSON.stringify({
    providerId: model.providerId,
    apiModelId: model.apiModelId ?? '',
    capabilities: model.capabilities.toSorted(),
    inputModalities: model.inputModalities?.toSorted() ?? [],
    outputModalities: model.outputModalities?.toSorted() ?? [],
    endpointTypes: model.endpointTypes ?? []
  })
}

function reconcileModelStatuses(statuses: ModelWithStatus[], models: readonly Model[]) {
  let changed = false
  const currentModels = new Map(models.map((model) => [model.id, model]))
  const next: ModelWithStatus[] = []

  for (const status of statuses) {
    const currentModel = currentModels.get(status.model.id)
    if (!currentModel || createModelCheckFingerprint(currentModel) !== createModelCheckFingerprint(status.model)) {
      changed = true
      continue
    }

    if (currentModel.name !== status.model.name) {
      changed = true
      next.push({ ...status, model: currentModel })
    } else {
      next.push(status)
    }
  }

  return changed ? next : statuses
}

function createInitialStatuses(models: readonly Model[]) {
  return models.map<ModelWithStatus>((model) => {
    const skipReason = getModelHealthCheckSkipReason(model)
    return skipReason
      ? {
          kind: 'skipped',
          model,
          checking: false,
          status: HealthStatus.NOT_CHECKED,
          keyResults: [],
          skipReason
        }
      : {
          kind: 'checking',
          model,
          checking: true,
          status: HealthStatus.NOT_CHECKED,
          keyResults: []
        }
  })
}

/** Runs a provider-wide model check in the background and streams row results. */
export function useHealthCheck(providerId: string, credentialsState: ModelCheckCredentialsState) {
  const { provider } = useProviderById(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const { credentialChangeVersion, prepareCredentials } = credentialsState
  const [isChecking, setIsChecking] = useState(false)
  const [lastCheckResults, setLastCheckResults] = useState<ModelWithStatus[] | null>(null)
  const isCheckingRef = useRef(false)
  const modelsRef = useRef(models)
  const statusesRef = useRef<ModelWithStatus[]>([])
  const runIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    modelsRef.current = models
  }, [models])

  /**
   * Publishes the run's rows and drops every other row's result — including results a
   * previous mount left in the cache. The cache itself skips writes whose value is unchanged.
   */
  const publishStatuses = useCallback((statuses: ModelWithStatus[]) => {
    const nextIds = new Set(statuses.map((status) => status.model.id))
    const staleIds = [...statusesRef.current.map((status) => status.model.id), ...modelsRef.current.map((m) => m.id)]
    for (const modelId of staleIds) {
      if (!nextIds.has(modelId)) clearModelHealthStatus(modelId)
    }
    statusesRef.current = statuses
    statuses.forEach(writeModelHealthStatus)
  }, [])

  const abortInFlightCheck = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    runIdRef.current += 1
    isCheckingRef.current = false
    setIsChecking(false)
  }, [])

  const runHealthCheck = useCallback(
    async ({
      runId,
      controller,
      initialStatuses,
      checkableModels,
      originalIndexes,
      credentials,
      isConcurrent,
      timeout
    }: {
      runId: number
      controller: AbortController
      initialStatuses: ModelWithStatus[]
      checkableModels: Model[]
      originalIndexes: number[]
      credentials: ModelCheckCredential[]
      isConcurrent: boolean
      timeout: number
    }) => {
      let finalStatuses = initialStatuses

      try {
        const checkedResults = await checkModelsHealth(
          {
            models: checkableModels,
            credentials,
            isConcurrent,
            timeout,
            signal: controller.signal
          },
          (checkResult, index) => {
            if (runIdRef.current !== runId || controller.signal.aborted) return
            const originalIndex = originalIndexes[index]
            if (originalIndex == null) return

            statusesRef.current = statusesRef.current.with(originalIndex, checkResult)
            writeModelHealthStatus(checkResult)
          }
        )
        if (runIdRef.current !== runId || controller.signal.aborted) return

        finalStatuses = [...initialStatuses]
        checkedResults.forEach((result, index) => {
          const originalIndex = originalIndexes[index]
          if (originalIndex != null) finalStatuses[originalIndex] = result
        })
        finalStatuses = reconcileModelStatuses(finalStatuses, modelsRef.current)
        publishStatuses(finalStatuses)
        setLastCheckResults(finalStatuses)
        toast.success(summarizeHealthResults(finalStatuses, provider?.name))
      } catch (error) {
        if (runIdRef.current !== runId || controller.signal.aborted) return
        logger.error('All-model check failed', { providerId, runId, error })
        toast.error(i18n.t('settings.models.check.failed_to_start'))
      } finally {
        if (runIdRef.current === runId) {
          abortControllerRef.current = null
          isCheckingRef.current = false
          setIsChecking(false)
        }
      }
    },
    [provider?.name, providerId, publishStatuses]
  )

  const startHealthCheck = useCallback(
    async ({
      keySelection,
      isConcurrent,
      timeout
    }: {
      keySelection: ModelCheckKeySelection
      isConcurrent: boolean
      timeout: number
    }) => {
      if (!provider || isCheckingRef.current) return false

      abortInFlightCheck()
      setLastCheckResults(null)
      const controller = new AbortController()
      abortControllerRef.current = controller
      const runId = ++runIdRef.current
      isCheckingRef.current = true
      setIsChecking(true)
      let backgroundStarted = false

      try {
        const credentials = await prepareCredentials(keySelection, controller.signal)
        if (runIdRef.current !== runId || controller.signal.aborted) return false

        const runModels = modelsRef.current

        if (runModels.length === 0) {
          toast.error({ timeout: 5000, title: i18n.t('settings.provider.no_models_for_check') })
          return false
        }

        const initialStatuses = createInitialStatuses(runModels)
        const originalIndexes = initialStatuses.flatMap((status, index) => (status.kind === 'skipped' ? [] : [index]))
        const checkableModels = originalIndexes
          .map((index) => runModels[index])
          .filter((model): model is Model => !!model)
        publishStatuses(initialStatuses)

        if (checkableModels.length === 0) {
          abortControllerRef.current = null
          isCheckingRef.current = false
          setIsChecking(false)
          toast.success(summarizeHealthResults(initialStatuses, provider.name))
          return true
        }

        backgroundStarted = true
        void runHealthCheck({
          runId,
          controller,
          initialStatuses,
          checkableModels,
          originalIndexes,
          credentials,
          isConcurrent,
          timeout
        })
        return true
      } catch (error) {
        if (runIdRef.current !== runId || controller.signal.aborted) return false
        if (error instanceof ModelCheckCredentialsSaveError) {
          logger.error('Failed to save API keys before all-model check', { providerId, error: error.cause })
        } else if (error instanceof ModelCheckCredentialsError) {
          toast.error(i18n.t('message.error.enter.api.label'))
        } else {
          logger.error('Failed to prepare all-model check', { providerId, error })
          toast.error(i18n.t('settings.models.check.failed_to_start'))
        }
        return false
      } finally {
        if (!backgroundStarted && runIdRef.current === runId) {
          abortControllerRef.current = null
          isCheckingRef.current = false
          setIsChecking(false)
        }
      }
    },
    [abortInFlightCheck, prepareCredentials, provider, providerId, publishStatuses, runHealthCheck]
  )

  // Any change to what is being checked (provider, endpoint, credentials) invalidates the run and
  // its results; the cleanup also covers unmount.
  useEffect(() => {
    publishStatuses([])
    setLastCheckResults(null)
    return () => {
      abortInFlightCheck()
      publishStatuses([])
      setLastCheckResults(null)
    }
  }, [abortInFlightCheck, anthropicApiHost, apiHost, credentialChangeVersion, providerId, publishStatuses])

  useEffect(() => {
    if (isChecking) return
    const nextStatuses = reconcileModelStatuses(statusesRef.current, models)
    if (nextStatuses !== statusesRef.current) publishStatuses(nextStatuses)
  }, [isChecking, models, publishStatuses])

  return {
    isChecking,
    lastCheckResults,
    startHealthCheck
  }
}
'@ | Set-Content -Path $path -Encoding UTF8 -NoNewline

Write-Host 'Writing src\renderer\pages\settings\ProviderSettings\ModelList\modelListHealthContext.tsx'
$path = 'src\renderer\pages\settings\ProviderSettings\ModelList\modelListHealthContext.tsx'
New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
@'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  lastCheckResults: ModelWithStatus[] | null
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
  const lastCheckResults = all.lastCheckResults
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
      lastCheckResults,
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
      lastCheckResults,
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
'@ | Set-Content -Path $path -Encoding UTF8 -NoNewline

Write-Host 'Writing src\renderer\pages\settings\ProviderSettings\ModelList\ModelList.tsx'
$path = 'src\renderer\pages\settings\ProviderSettings\ModelList\ModelList.tsx'
New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
@'
import React, { memo } from 'react'

import { ButtonGroup } from '@cherrystudio/ui'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { useModelListHealthRun } from './modelListHealthContext'
import ProviderModelAdd from './ProviderModelAdd'
import ProviderModelDownload from './ProviderModelDownload'
import ProviderModelList from './ProviderModelList'
import ProviderModelPullReconcile from './ProviderModelPullReconcile'
import ProviderModelRemoveFailed from './ProviderModelRemoveFailed'

interface ModelListProps {
  providerId: string
  modelPullGuideVersion?: number
  onContinueApiSetup?: () => void
}

function ModelListContent({
  providerId,
  modelPullGuideVersion = 0,
  onContinueApiSetup
}: {
  providerId: string
  modelPullGuideVersion?: number
  onContinueApiSetup?: () => void
}) {
  const { isModelChecking } = useModelListHealthRun()
  const disabled = isModelChecking

  return (
    <>
      <ProviderModelList
        providerId={providerId}
        disabled={disabled}
        onContinueApiSetup={onContinueApiSetup}
        actions={({ disabled: toolbarDisabled }) => (
          <ButtonGroup className={modelListClasses.toolbarButtonGroup}>
            <ProviderModelRemoveFailed disabled={toolbarDisabled} />
            <ProviderModelPullReconcile
              providerId={providerId}
              disabled={toolbarDisabled}
              guideVersion={modelPullGuideVersion}
            />
            {providerId === 'ovms' ? (
              <ProviderModelDownload providerId={providerId} disabled={toolbarDisabled} />
            ) : (
              <ProviderModelAdd providerId={providerId} disabled={toolbarDisabled} />
            )}
          </ButtonGroup>
        )}
      />
    </>
  )
}

const ModelList: React.FC<ModelListProps> = ({ providerId, modelPullGuideVersion = 0, onContinueApiSetup }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListContent
          providerId={providerId}
          modelPullGuideVersion={modelPullGuideVersion}
          onContinueApiSetup={onContinueApiSetup}
        />
      </section>
    </div>
  )
}

export default memo(ModelList)
'@ | Set-Content -Path $path -Encoding UTF8 -NoNewline

Write-Host 'Patching src\renderer\i18n\locales\en-us.json'
$i18nPath = 'src\renderer\i18n\locales\en-us.json'
$i18nContent = Get-Content -Path $i18nPath -Raw -Encoding UTF8
if ($i18nContent -notmatch 'remove_failed_button_one') {
  $marker = '"settings.models.check.passed": "Passed",'
  $insert = $marker + "`r`n" + 
    '  "settings.models.check.remove_failed_button_one": "Remove {{count}} failed",' + "`r`n" +
    '  "settings.models.check.remove_failed_button_other": "Remove {{count}} failed",' + "`r`n" +
    '  "settings.models.check.remove_failed_success_one": "Removed {{count}} failed model",' + "`r`n" +
    '  "settings.models.check.remove_failed_success_other": "Removed {{count}} failed models",'
  $i18nContent = $i18nContent.Replace($marker, $insert)
  Set-Content -Path $i18nPath -Value $i18nContent -Encoding UTF8 -NoNewline
  Write-Host '  -> keys added'
} else {
  Write-Host '  -> keys already present, skipping'
}

Write-Host 'Syncing i18n across locales...'
pnpm i18n:sync

Write-Host 'Done. Starting dev server...'
pnpm dev