import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { serializeHealthCheckError } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { UniqueModelId } from '@shared/data/types/model'
import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelListSyncContent, useModelListSyncView, useProviderModelPullReconcile } from '../ModelList'
import { chunkArray } from '../utils/chunkArray'
import { checkApi, getModelHealthCheckSkipReason, healthCheckErrorToDisplayString } from '../utils/healthCheck'
import { resolveCreateModelEndpointTypes, toCreateModelDto } from '../utils/modelSync'

export type ProviderApiSetupInitialStep = 'api-key' | 'models'

interface ProviderApiSetupDialogProps {
  providerId: string
  initialStep: ProviderApiSetupInitialStep
  onClose: () => void
}

type SetupBusyState = 'saving-key' | 'loading-models' | 'creating-models' | 'checking' | 'enabling' | null
type SetupErrorKind = 'api-key' | 'models' | 'create' | 'check' | 'enable'

interface SetupError {
  kind: SetupErrorKind
  message: string
}

function safeErrorSummary(error: unknown, apiKeys: string[]) {
  return apiKeys.reduce(
    (summary, key) => {
      const normalizedKey = key.trim()
      return normalizedKey ? summary.replaceAll(normalizedKey, '••••') : summary
    },
    healthCheckErrorToDisplayString(serializeHealthCheckError(error))
  )
}

export default function ProviderApiSetupDialog({ providerId, initialStep, onClose }: ProviderApiSetupDialogProps) {
  const { t } = useTranslation()
  const { provider, addApiKey, updateApiKey, updateProvider, enableProvider } = useProvider(providerId)
  const { data: apiKeysData, isLoading: isLoadingApiKeys } = useProviderApiKeys(providerId)
  const { createModels } = useModelMutations()
  const {
    allModels: availableModels,
    localModels,
    reloadModels,
    isLoadingModels
  } = useProviderModelPullReconcile(providerId)
  const [step, setStep] = useState<ProviderApiSetupInitialStep>(initialStep)
  const [apiKey, setApiKey] = useState('')
  const [savedKeyId, setSavedKeyId] = useState<string | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<UniqueModelId>>(() => new Set())
  const [modelViewResetVersion, setModelViewResetVersion] = useState(0)
  const [busyState, setBusyState] = useState<SetupBusyState>(null)
  const [error, setError] = useState<SetupError | null>(null)
  const [requiresManualConfirmation, setRequiresManualConfirmation] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(true)
  const initializedRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const createdModelIdsRef = useRef(new Set<UniqueModelId>())
  const probeSucceededModelIdRef = useRef<string | null>(null)

  const isBusy = busyState !== null
  const localModelIds = useMemo(() => new Set(localModels.map((model) => model.id)), [localModels])
  const modelListView = useModelListSyncView({
    models: availableModels,
    resetKey: modelViewResetVersion
  })
  const selectedModels = useMemo(
    () => availableModels.filter((model) => selectedModelIds.has(model.id)),
    [availableModels, selectedModelIds]
  )
  const allFilteredSelected =
    modelListView.filteredModels.length > 0 &&
    modelListView.filteredModels.every((model) => selectedModelIds.has(model.id))
  const storedApiKey = apiKeysData?.keys.find((entry) => entry.isEnabled) ?? apiKeysData?.keys[0]
  const runtimeApiKey = provider?.apiKeys.find((entry) => entry.isEnabled) ?? provider?.apiKeys[0]
  const editableApiKeyId = savedKeyId ?? storedApiKey?.id ?? runtimeApiKey?.id ?? null

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) {
      return
    }

    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  const requestClose = useCallback(() => {
    clearCloseTimer()
    setDialogOpen(false)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      onClose()
    }, DIALOG_UNMOUNT_DELAY_MS)
  }, [clearCloseTimer, onClose])

  const createError = useCallback(
    (kind: SetupErrorKind, fallbackKey: string, cause: unknown): SetupError => {
      const fallback = t(fallbackKey)
      const storedKeys = apiKeysData?.keys
      const canSafelyShowSummary = apiKey.trim().length > 0 || storedKeys !== undefined
      const summary = canSafelyShowSummary
        ? safeErrorSummary(cause, [apiKey, ...(storedKeys?.map((entry) => entry.key) ?? [])])
        : ''
      return { kind, message: summary ? `${fallback}: ${summary}` : fallback }
    },
    [apiKey, apiKeysData?.keys, t]
  )

  const keepProviderDisabled = useCallback(async () => {
    if (provider?.isEnabled) {
      await updateProvider({ isEnabled: false })
    }
  }, [provider?.isEnabled, updateProvider])

  const loadModels = useCallback(async () => {
    setBusyState('loading-models')
    setError(null)
    setRequiresManualConfirmation(false)
    setSelectedModelIds(new Set())
    setModelViewResetVersion((version) => version + 1)
    probeSucceededModelIdRef.current = null

    try {
      await keepProviderDisabled()
      const result = await reloadModels()
      if (!result) {
        return
      }
      if (result.error) {
        setError(createError('models', 'settings.models.manage.sync_pull_failed', result.error))
      } else if (result.models.length === 0 && localModels.length === 0) {
        setError({ kind: 'models', message: t('settings.provider.api_setup.no_models') })
      }
    } catch (cause) {
      setSelectedModelIds(new Set())
      setError(createError('models', 'settings.models.manage.sync_pull_failed', cause))
    } finally {
      setBusyState(null)
    }
  }, [createError, keepProviderDisabled, localModels.length, reloadModels, t])

  useEffect(() => {
    if (initializedRef.current || initialStep !== 'models' || isLoadingApiKeys) {
      return
    }

    initializedRef.current = true
    void loadModels()
  }, [initialStep, isLoadingApiKeys, loadModels])

  const saveApiKey = useCallback(async () => {
    const normalizedApiKey = apiKey.trim()
    if (!normalizedApiKey || isBusy) {
      return
    }

    setBusyState('saving-key')
    setError(null)
    try {
      await keepProviderDisabled()
      if (editableApiKeyId) {
        await updateApiKey(editableApiKeyId, { key: normalizedApiKey, isEnabled: true })
        setSavedKeyId(editableApiKeyId)
      } else {
        const previousIds = new Set(provider?.apiKeys.map((entry) => entry.id) ?? [])
        const updatedProvider = await addApiKey(normalizedApiKey)
        const createdKey = updatedProvider.apiKeys.find((entry) => !previousIds.has(entry.id))
        if (!createdKey) {
          throw new Error('Saved API key could not be identified')
        }
        setSavedKeyId(createdKey.id)
      }

      setStep('models')
      await loadModels()
    } catch (cause) {
      setError(createError('api-key', 'settings.provider.api_key.save_failed', cause))
    } finally {
      setBusyState(null)
    }
  }, [
    addApiKey,
    apiKey,
    createError,
    editableApiKeyId,
    isBusy,
    keepProviderDisabled,
    loadModels,
    provider?.apiKeys,
    updateApiKey
  ])

  const setModelSelection = useCallback((modelIds: UniqueModelId[], selected: boolean) => {
    setSelectedModelIds((current) => {
      const next = new Set(current)
      for (const modelId of modelIds) {
        if (selected) {
          next.add(modelId)
        } else {
          next.delete(modelId)
        }
      }
      return next
    })
  }, [])

  const toggleAllFiltered = useCallback(() => {
    setSelectedModelIds((current) => {
      const next = new Set(current)
      if (
        modelListView.filteredModels.length > 0 &&
        modelListView.filteredModels.every((model) => next.has(model.id))
      ) {
        for (const model of modelListView.filteredModels) {
          next.delete(model.id)
        }
      } else {
        for (const model of modelListView.filteredModels) {
          next.add(model.id)
        }
      }
      return next
    })
  }, [modelListView.filteredModels])

  const completeSetup = useCallback(async () => {
    if (selectedModels.length === 0 || isBusy) {
      return
    }

    setError(null)
    setRequiresManualConfirmation(false)

    try {
      await keepProviderDisabled()
      const existingModelIds = new Set([...localModels.map((model) => model.id), ...createdModelIdsRef.current])
      const modelsToCreate = selectedModels.filter((model) => !existingModelIds.has(model.id))

      if (modelsToCreate.length > 0) {
        setBusyState('creating-models')
        for (const modelChunk of chunkArray(modelsToCreate, MODELS_BATCH_MAX_ITEMS)) {
          await createModels(
            modelChunk.map((model) =>
              toCreateModelDto(providerId, model, resolveCreateModelEndpointTypes(provider, model))
            )
          )
          for (const model of modelChunk) {
            createdModelIdsRef.current.add(model.id)
          }
        }
      }
    } catch (cause) {
      setBusyState(null)
      setError(createError('create', 'settings.models.manage.operation_failed', cause))
      return
    }

    const probeModel = selectedModels.find((model) => getModelHealthCheckSkipReason(model) === null)
    if (!probeModel) {
      setBusyState(null)
      setRequiresManualConfirmation(true)
      return
    }

    if (probeSucceededModelIdRef.current !== probeModel.id) {
      setBusyState('checking')
      try {
        await checkApi(probeModel.id, { timeout: 15000 })
        probeSucceededModelIdRef.current = probeModel.id
      } catch (cause) {
        setBusyState(null)
        setError(createError('check', 'settings.provider.api_setup.check_failed', cause))
        return
      }
    }

    setBusyState('enabling')
    try {
      await enableProvider()
      toast.success(t('settings.provider.api_setup.success'))
      setBusyState(null)
      requestClose()
    } catch (cause) {
      setBusyState(null)
      setError(createError('enable', 'settings.provider.api_setup.enable_failed', cause))
    }
  }, [
    createError,
    createModels,
    enableProvider,
    isBusy,
    keepProviderDisabled,
    localModels,
    provider,
    providerId,
    requestClose,
    selectedModels,
    t
  ])

  const editSavedKey = useCallback(() => {
    setError(null)
    setRequiresManualConfirmation(false)
    setApiKey((current) => current || storedApiKey?.key || '')
    setStep('api-key')
  }, [storedApiKey?.key])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isBusy) {
        requestClose()
      }
    },
    [isBusy, requestClose]
  )

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        closeOnOverlayClick={!isBusy}
        className={cn(
          'gap-5 sm:max-w-[640px]',
          step === 'models' && 'h-[min(720px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto]'
        )}>
        <DialogHeader>
          <DialogTitle>
            {t(step === 'api-key' ? 'settings.provider.api_setup.add_key' : 'settings.provider.api_setup.models_title')}
          </DialogTitle>
        </DialogHeader>

        {step === 'api-key' ? (
          <div className="space-y-4">
            <Input
              autoFocus
              type="password"
              value={apiKey}
              disabled={isBusy}
              spellCheck={false}
              placeholder={t('settings.provider.api.key.new_key.placeholder')}
              aria-label={t('settings.provider.api_key.label')}
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && apiKey.trim()) {
                  event.preventDefault()
                  void saveApiKey()
                }
              }}
            />
            {error?.kind === 'api-key' ? <SetupErrorMessage message={error.message} /> : null}
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
            <ModelListSyncContent
              mode="select"
              provider={provider}
              view={modelListView}
              localModelIds={localModelIds}
              selectedModelIds={selectedModelIds}
              isLoading={busyState === 'loading-models' || isLoadingModels}
              isApplying={isBusy}
              disabled={error?.kind === 'models' || requiresManualConfirmation}
              onSelectModels={setModelSelection}
              toolbarAction={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    modelListView.filteredModels.length === 0 ||
                    isBusy ||
                    error?.kind === 'models' ||
                    requiresManualConfirmation
                  }
                  onClick={toggleAllFiltered}>
                  {t(allFilteredSelected ? 'settings.provider.api_setup.deselect_all' : 'common.select_all')}
                </Button>
              }
            />

            {error ? <SetupErrorMessage message={error.message} /> : null}
            {requiresManualConfirmation ? (
              <div className="rounded-xl border border-warning-border bg-warning-subtle p-3 text-warning-subtle-foreground">
                <div className="font-medium text-sm">{t('settings.provider.api_setup.manual_title')}</div>
                <div className="mt-1 text-xs leading-5">{t('settings.provider.api_setup.manual_description')}</div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <div>
            {step === 'models' && editableApiKeyId && !requiresManualConfirmation ? (
              <Button type="button" variant="ghost" disabled={isBusy} onClick={editSavedKey}>
                {t('settings.provider.api_setup.edit_key')}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {!requiresManualConfirmation ? (
              <Button type="button" variant="outline" disabled={isBusy} onClick={requestClose}>
                {t('common.cancel')}
              </Button>
            ) : null}
            {step === 'api-key' ? (
              <Button type="button" disabled={!apiKey.trim() || isBusy} onClick={() => void saveApiKey()}>
                {busyState === 'saving-key' ? t('common.loading') : t('settings.provider.api_setup.save_key')}
              </Button>
            ) : requiresManualConfirmation ? (
              <Button type="button" onClick={requestClose}>
                {t('common.close')}
              </Button>
            ) : error?.kind === 'models' ? (
              <Button type="button" disabled={isBusy} onClick={() => void loadModels()}>
                {t('common.retry')}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={selectedModels.length === 0 || isBusy}
                onClick={() => void completeSetup()}>
                {isBusy
                  ? t(
                      busyState === 'loading-models'
                        ? 'settings.provider.api_setup.loading_models'
                        : 'settings.provider.api_setup.verifying'
                    )
                  : error
                    ? t('common.retry')
                    : t('settings.provider.api_setup.add_and_verify')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SetupErrorMessage({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs leading-5',
        className
      )}>
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  )
}
