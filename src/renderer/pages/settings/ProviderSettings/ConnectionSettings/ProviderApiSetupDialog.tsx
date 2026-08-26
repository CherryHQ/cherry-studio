import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tooltip
} from '@cherrystudio/ui'
import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import type { ModelServiceSetupFilter } from '@renderer/services/ModelServiceSetupService'
import { cn } from '@renderer/utils/style'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { AlertCircle, ArrowLeft, CheckCircle2, Circle, CircleAlert, CircleX, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import {
  ModelListSyncContent,
  ProviderModelAddDialog,
  useModelListSyncView,
  useProviderModelPullReconcile
} from '../ModelList'
import { ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'
import { checkApi, getModelHealthCheckSkipReason } from '../utils/healthCheck'
import { getProviderSetupErrorSummary, persistProviderModels } from '../utils/providerModelSetup'

const SUCCESS_FEEDBACK_DURATION_MS = 1200

export type ProviderApiSetupInitialStep = 'api-key' | 'models'
export type ProviderApiSetupModelSelectionMode = 'setup' | 'check'
type ProviderApiSetupStep = ProviderApiSetupInitialStep | 'verification'

interface ProviderApiSetupDialogProps {
  providerId: string
  initialStep: ProviderApiSetupInitialStep
  modelSelectionMode?: ProviderApiSetupModelSelectionMode
  modelFilter?: ModelServiceSetupFilter
  seamlessTransitions?: boolean
  onBack?: () => void
  onClose: () => void
  onCloseAutoFocus?: () => void
  onSetupSuccess?: (models: Model[]) => void
}

type SetupBusyState =
  | 'saving-key'
  | 'loading-models'
  | 'preparing-verification'
  | 'creating-models'
  | 'checking'
  | 'enabling'
  | null
type SetupErrorKind = 'api-key' | 'models' | 'create' | 'check' | 'enable'
type VerificationStep = 'models' | 'check' | 'enable'
type VerificationStepStatus = 'pending' | 'active' | 'complete' | 'error' | 'warning'

interface SetupError {
  kind: SetupErrorKind
  message: string
}

export default function ProviderApiSetupDialog({
  providerId,
  initialStep,
  modelSelectionMode = 'setup',
  modelFilter,
  seamlessTransitions = false,
  onBack,
  onClose,
  onCloseAutoFocus,
  onSetupSuccess
}: ProviderApiSetupDialogProps) {
  const { t } = useTranslation()
  const { provider, addApiKey, updateApiKey, updateProvider, enableProvider } = useProvider(providerId)
  const providerMeta = useProviderMeta(providerId)
  const { data: apiKeysData, isLoading: isLoadingApiKeys } = useProviderApiKeys(providerId)
  const { createModels, updateModels } = useModelMutations()
  const {
    allModels: unfilteredAvailableModels,
    localModels: unfilteredLocalModels,
    reloadModels,
    isLoadingModels
  } = useProviderModelPullReconcile(providerId)
  const [step, setStep] = useState<ProviderApiSetupStep>(initialStep)
  const [apiKey, setApiKey] = useState('')
  const [savedKeyId, setSavedKeyId] = useState<string | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<UniqueModelId>>(() => new Set())
  const [modelViewResetVersion, setModelViewResetVersion] = useState(0)
  const [busyState, setBusyState] = useState<SetupBusyState>(null)
  const [error, setError] = useState<SetupError | null>(null)
  const [requiresManualConfirmation, setRequiresManualConfirmation] = useState(false)
  const [setupSucceeded, setSetupSucceeded] = useState(false)
  const [completedVerificationSteps, setCompletedVerificationSteps] = useState<Set<VerificationStep>>(() => new Set())
  const [manualModelDialogOpen, setManualModelDialogOpen] = useState(false)
  const [pendingManualModelIds, setPendingManualModelIds] = useState<UniqueModelId[]>([])
  const [dialogOpen, setDialogOpen] = useState(true)
  const [useDefaultDialogMotion, setUseDefaultDialogMotion] = useState(!seamlessTransitions)
  const initializedRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeIntentRef = useRef<'back' | 'dismiss' | 'manual'>('dismiss')
  const persistedModelsRef = useRef(new Map<UniqueModelId, Model>())
  const probeSucceededModelIdRef = useRef<string | null>(null)

  const isBusy = busyState !== null
  const canDismissDialog = !isBusy || busyState === 'loading-models'
  const availableModels = useMemo(
    () => unfilteredAvailableModels.filter((model) => modelFilter?.(model, provider) ?? true),
    [modelFilter, provider, unfilteredAvailableModels]
  )
  const localModels = useMemo(
    () => unfilteredLocalModels.filter((model) => modelFilter?.(model, provider) ?? true),
    [modelFilter, provider, unfilteredLocalModels]
  )
  const localModelIds = useMemo(() => new Set(localModels.map((model) => model.id)), [localModels])
  const modelListView = useModelListSyncView({
    models: availableModels,
    resetKey: modelViewResetVersion
  })
  const selectedModels = useMemo(
    () => availableModels.filter((model) => selectedModelIds.has(model.id)),
    [availableModels, selectedModelIds]
  )
  const probeModel = useMemo(
    () => selectedModels.find((model) => getModelHealthCheckSkipReason(model) === null),
    [selectedModels]
  )
  const allFilteredSelected =
    modelListView.filteredModels.length > 0 &&
    modelListView.filteredModels.every((model) => selectedModelIds.has(model.id))
  const storedApiKey = apiKeysData?.keys.find((entry) => entry.isEnabled) ?? apiKeysData?.keys[0]
  const runtimeApiKey = provider?.apiKeys.find((entry) => entry.isEnabled) ?? provider?.apiKeys[0]
  const editableApiKeyId = savedKeyId ?? storedApiKey?.id ?? runtimeApiKey?.id ?? null
  const verificationApiKey = apiKey.trim() || storedApiKey?.key || ''
  const canAddModelManually = provider != null && provider.presetProviderId == null
  const activeVerificationStep: VerificationStep | null =
    busyState === 'preparing-verification' || busyState === 'creating-models'
      ? 'models'
      : busyState === 'checking'
        ? 'check'
        : busyState === 'enabling'
          ? 'enable'
          : null
  const failedVerificationStep: VerificationStep | null =
    error?.kind === 'create' ? 'models' : error?.kind === 'check' ? 'check' : error?.kind === 'enable' ? 'enable' : null
  const verificationSteps = [
    { id: 'models', label: t('settings.provider.api_setup.progress.add_models') },
    {
      id: 'check',
      label: probeModel
        ? t('settings.provider.api_setup.progress.check_model_named', { model: probeModel.name })
        : t('settings.provider.api_setup.progress.check_model')
    },
    { id: 'enable', label: t('settings.provider.api_setup.progress.enable_provider') }
  ] as const
  const verificationStatusMessage =
    busyState === 'preparing-verification' || busyState === 'creating-models'
      ? t('settings.provider.api_setup.status.adding_models')
      : busyState === 'checking' && probeModel
        ? t('settings.provider.api_setup.status.checking_model', { model: probeModel.name })
        : busyState === 'enabling'
          ? t('settings.provider.api_setup.status.enabling_provider')
          : t('settings.provider.api_setup.verifying')

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) {
      return
    }

    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  const requestExit = useCallback(
    (intent: 'back' | 'dismiss', callback: () => void) => {
      clearCloseTimer()
      closeIntentRef.current = intent
      setUseDefaultDialogMotion(intent === 'dismiss')
      setDialogOpen(false)
      if (seamlessTransitions && intent === 'back') {
        callback()
        return
      }
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        callback()
      }, DIALOG_UNMOUNT_DELAY_MS)
    },
    [clearCloseTimer, seamlessTransitions]
  )

  const requestClose = useCallback(() => requestExit('dismiss', onClose), [onClose, requestExit])
  const requestBack = useCallback(() => {
    if (onBack) {
      requestExit('back', onBack)
    }
  }, [onBack, requestExit])

  useEffect(() => {
    if (!setupSucceeded) {
      return
    }

    const timer = setTimeout(requestClose, SUCCESS_FEEDBACK_DURATION_MS)
    return () => clearTimeout(timer)
  }, [requestClose, setupSucceeded])

  const createError = useCallback(
    (kind: SetupErrorKind, fallbackKey: string, cause: unknown): SetupError => {
      const fallback = t(fallbackKey)
      const storedKeys = apiKeysData?.keys
      const canSafelyShowSummary = apiKey.trim().length > 0 || storedKeys !== undefined
      const summary = canSafelyShowSummary
        ? getProviderSetupErrorSummary(cause, [apiKey, ...(storedKeys?.map((entry) => entry.key) ?? [])])
        : ''
      return { kind, message: summary ? `${fallback} ${summary}` : fallback }
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
    setSetupSucceeded(false)
    setCompletedVerificationSteps(new Set())
    setSelectedModelIds(new Set(localModelIds))
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
      } else {
        const compatibleRemoteModels = result.models.filter((model) => modelFilter?.(model, provider) ?? true)
        if (compatibleRemoteModels.length === 0 && localModelIds.size === 0) {
          const hasUnfilteredModels = result.models.length > 0 || unfilteredLocalModels.length > 0
          setError({
            kind: 'models',
            message: t(
              hasUnfilteredModels
                ? 'settings.provider.api_setup.no_compatible_models'
                : 'settings.provider.api_setup.no_models'
            )
          })
        }
      }
    } catch (cause) {
      setSelectedModelIds(new Set())
      setError(createError('models', 'settings.models.manage.sync_pull_failed', cause))
    } finally {
      setBusyState(null)
    }
  }, [createError, keepProviderDisabled, localModelIds, modelFilter, provider, reloadModels, t, unfilteredLocalModels])

  useEffect(() => {
    if (pendingManualModelIds.length === 0) {
      return
    }

    const pendingIdSet = new Set(pendingManualModelIds)
    const addedModels = unfilteredLocalModels.filter((model) => pendingIdSet.has(model.id))
    if (addedModels.length !== pendingManualModelIds.length) {
      return
    }

    const compatibleModels = addedModels.filter((model) => modelFilter?.(model, provider) ?? true)
    if (compatibleModels.length === 0) {
      setError({ kind: 'models', message: t('settings.provider.api_setup.no_compatible_models') })
    } else {
      setError(null)
      setSelectedModelIds((current) => new Set([...current, ...compatibleModels.map((model) => model.id)]))
    }
    setPendingManualModelIds([])
    setModelViewResetVersion((version) => version + 1)
  }, [modelFilter, pendingManualModelIds, provider, t, unfilteredLocalModels])

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
    if (!provider || selectedModels.length === 0 || isBusy) {
      return
    }

    setBusyState('preparing-verification')
    setError(null)
    setRequiresManualConfirmation(false)
    setSetupSucceeded(false)

    let configuredModels: Model[]
    try {
      await keepProviderDisabled()
      setBusyState('creating-models')
      configuredModels = await persistProviderModels({
        provider,
        selectedModels,
        localModels,
        knownModels: persistedModelsRef.current.values(),
        createModels,
        updateModels,
        onPersisted: (models) => {
          for (const model of models) persistedModelsRef.current.set(model.id, model)
        }
      })
    } catch (cause) {
      setBusyState(null)
      setError(createError('create', 'settings.models.manage.operation_failed', cause))
      return
    }

    setCompletedVerificationSteps((current) => new Set(current).add('models'))

    if (!probeModel) {
      setBusyState(null)
      setRequiresManualConfirmation(true)
      return
    }

    if (probeSucceededModelIdRef.current !== probeModel.id) {
      setBusyState('checking')
      try {
        await checkApi(probeModel.id, {
          ...(verificationApiKey ? { apiKey: verificationApiKey } : {}),
          timeout: 15000
        })
        probeSucceededModelIdRef.current = probeModel.id
      } catch (cause) {
        setBusyState(null)
        setError(createError('check', 'settings.provider.api_setup.check_failed', cause))
        return
      }
    }

    setCompletedVerificationSteps((current) => new Set(current).add('check'))

    setBusyState('enabling')
    try {
      await enableProvider()
      setCompletedVerificationSteps((current) => new Set(current).add('enable'))
      setBusyState(null)
      onSetupSuccess?.(configuredModels)
      setSetupSucceeded(true)
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
    onSetupSuccess,
    provider,
    probeModel,
    selectedModels,
    updateModels,
    verificationApiKey
  ])

  const startVerification = useCallback(() => {
    if (selectedModels.length === 0 || isBusy) {
      return
    }

    setCompletedVerificationSteps(new Set())
    setStep('verification')
    void completeSetup()
  }, [completeSetup, isBusy, selectedModels.length])

  const returnToModels = useCallback(() => {
    if (isBusy) {
      return
    }

    setError(null)
    setRequiresManualConfirmation(false)
    setSetupSucceeded(false)
    setCompletedVerificationSteps(new Set())
    setStep('models')
  }, [isBusy])

  const handleManualModelSuccess = useCallback((modelIds: UniqueModelId[]) => {
    setManualModelDialogOpen(false)
    closeIntentRef.current = 'dismiss'
    setPendingManualModelIds(modelIds)
  }, [])

  const openManualModelDialog = useCallback(() => {
    closeIntentRef.current = 'manual'
    setManualModelDialogOpen(true)
  }, [])

  const closeManualModelDialog = useCallback(() => {
    setManualModelDialogOpen(false)
    closeIntentRef.current = 'dismiss'
  }, [])

  const editSavedKey = useCallback(() => {
    setError(null)
    setRequiresManualConfirmation(false)
    setSetupSucceeded(false)
    setCompletedVerificationSteps(new Set())
    setApiKey((current) => current || storedApiKey?.key || '')
    setStep('api-key')
  }, [storedApiKey?.key])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && canDismissDialog) {
        requestClose()
      }
    },
    [canDismissDialog, requestClose]
  )

  return (
    <>
      <Dialog open={dialogOpen && !manualModelDialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          closeOnOverlayClick={canDismissDialog}
          showCloseButton={step !== 'verification' || !isBusy}
          size="lg"
          motion={useDefaultDialogMotion ? 'directional' : 'none'}
          onCloseAutoFocus={(event) => {
            if (closeIntentRef.current !== 'dismiss') {
              event.preventDefault()
              return
            }
            if (onCloseAutoFocus) {
              event.preventDefault()
              onCloseAutoFocus()
            }
          }}
          className={cn(
            'gap-5',
            step === 'models' &&
              error?.kind !== 'models' &&
              'h-[min(720px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto]'
          )}>
          {step === 'verification' ? (
            <DialogTitle className="sr-only">{t('settings.provider.api_setup.add_and_verify')}</DialogTitle>
          ) : (
            <DialogHeader>
              <div className="flex items-center gap-2">
                {onBack ? (
                  <Tooltip content={t('settings.provider.api_setup.back_to_providers')}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('settings.provider.api_setup.back_to_providers')}
                      disabled={!canDismissDialog}
                      onClick={requestBack}>
                      <ArrowLeft className="size-4" />
                    </Button>
                  </Tooltip>
                ) : null}
                <DialogTitle>
                  {t(
                    step === 'api-key'
                      ? 'settings.provider.api_setup.add_key'
                      : modelSelectionMode === 'check'
                        ? 'settings.provider.api_setup.models_check_title'
                        : 'settings.provider.api_setup.models_title'
                  )}
                </DialogTitle>
              </div>
            </DialogHeader>
          )}

          {step === 'api-key' ? (
            <div className="space-y-4">
              <div className="space-y-2">
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
                {providerMeta.apiKeyWebsite && !providerMeta.isDmxapi ? (
                  <div className="flex">
                    <ProviderHelpLink
                      target="_blank"
                      rel="noreferrer"
                      href={providerMeta.apiKeyWebsite}
                      className="mx-0">
                      {t('settings.provider.get_api_key')}
                    </ProviderHelpLink>
                  </div>
                ) : null}
              </div>
              {error?.kind === 'api-key' ? <SetupErrorMessage message={error.message} /> : null}
            </div>
          ) : step === 'models' ? (
            <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
              {error?.kind === 'models' ? (
                <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-1">
                  {canAddModelManually ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="w-full shrink-0"
                      disabled={isBusy}
                      onClick={openManualModelDialog}>
                      {t('settings.provider.api_setup.add_model_manually')}
                    </Button>
                  ) : null}
                  <SetupErrorMessage message={error.message} />
                </div>
              ) : (
                <ModelListSyncContent
                  mode="select"
                  provider={provider}
                  view={modelListView}
                  localModelIds={localModelIds}
                  selectedModelIds={selectedModelIds}
                  isLoading={busyState === 'loading-models' || isLoadingModels}
                  isApplying={isBusy}
                  disabled={requiresManualConfirmation}
                  hideEmptyFilters
                  flattenSingleGroup
                  onSelectModels={setModelSelection}
                  toolbarAction={
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={modelListView.filteredModels.length === 0 || isBusy || requiresManualConfirmation}
                      onClick={toggleAllFiltered}>
                      {t(allFilteredSelected ? 'settings.provider.api_setup.deselect_all' : 'common.select_all')}
                    </Button>
                  }
                />
              )}

              {error?.kind !== 'models' && error ? <SetupErrorMessage message={error.message} /> : null}
              {requiresManualConfirmation ? (
                <div className="rounded-xl border border-warning-border bg-warning-subtle p-3 text-warning-subtle-foreground">
                  <div className="font-medium text-sm">{t('settings.provider.api_setup.manual_title')}</div>
                  <div className="mt-1 text-xs leading-5">{t('settings.provider.api_setup.manual_description')}</div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              <div
                role={error ? 'alert' : 'status'}
                aria-live="polite"
                className="flex flex-col items-center gap-2 pt-1 text-center">
                <div
                  className={cn(
                    'flex size-10 items-center justify-center rounded-full',
                    setupSucceeded
                      ? 'bg-success-subtle text-success'
                      : error
                        ? 'bg-error-subtle text-error'
                        : requiresManualConfirmation
                          ? 'bg-warning-subtle text-warning'
                          : 'bg-primary/10 text-primary'
                  )}>
                  {setupSucceeded ? (
                    <CheckCircle2 className="size-5" aria-hidden />
                  ) : error ? (
                    <CircleX className="size-5" aria-hidden />
                  ) : requiresManualConfirmation ? (
                    <CircleAlert className="size-5" aria-hidden />
                  ) : (
                    <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden />
                  )}
                </div>
                <div className="max-w-md text-sm leading-6">
                  {setupSucceeded
                    ? t('settings.provider.api_setup.success')
                    : error
                      ? error.message
                      : requiresManualConfirmation
                        ? t('settings.provider.api_setup.manual_title')
                        : verificationStatusMessage}
                </div>
                {requiresManualConfirmation ? (
                  <div className="max-w-md text-muted-foreground text-xs leading-5">
                    {t('settings.provider.api_setup.manual_description')}
                  </div>
                ) : null}
              </div>

              <ol className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
                {verificationSteps.map(({ id, label }) => {
                  let status: VerificationStepStatus = 'pending'
                  if (completedVerificationSteps.has(id)) {
                    status = 'complete'
                  } else if (failedVerificationStep === id) {
                    status = 'error'
                  } else if (requiresManualConfirmation && id === 'check') {
                    status = 'warning'
                  } else if (activeVerificationStep === id) {
                    status = 'active'
                  }

                  const statusText =
                    status === 'complete'
                      ? t('common.success')
                      : status === 'active'
                        ? t('common.loading')
                        : status === 'error'
                          ? t('settings.models.check.failed')
                          : status === 'warning'
                            ? t('settings.models.check.status_skipped')
                            : undefined

                  return <VerificationProgressRow key={id} label={label} status={status} statusText={statusText} />
                })}
              </ol>

              {error || requiresManualConfirmation ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" onClick={returnToModels}>
                    {t('settings.provider.api_setup.back_to_models')}
                  </Button>
                  {error && editableApiKeyId ? (
                    <Button type="button" variant="outline" onClick={editSavedKey}>
                      {t('settings.provider.api_setup.edit_key')}
                    </Button>
                  ) : null}
                  {error ? (
                    <Button type="button" onClick={() => void completeSetup()}>
                      {t('common.retry')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {step !== 'verification' ? (
            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              <div>
                {step === 'models' && editableApiKeyId ? (
                  <Button type="button" variant="ghost" disabled={isBusy} onClick={editSavedKey}>
                    {t('settings.provider.api_setup.edit_key')}
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" disabled={!canDismissDialog} onClick={requestClose}>
                  {t('common.cancel')}
                </Button>
                {step === 'api-key' ? (
                  <Button type="button" disabled={!apiKey.trim() || isBusy} onClick={() => void saveApiKey()}>
                    {busyState === 'saving-key' ? t('common.loading') : t('settings.provider.api_setup.save_key')}
                  </Button>
                ) : error?.kind === 'models' ? (
                  <Button type="button" disabled={isBusy} onClick={() => void loadModels()}>
                    {t('common.retry')}
                  </Button>
                ) : (
                  <Button type="button" disabled={selectedModels.length === 0 || isBusy} onClick={startVerification}>
                    {t('settings.provider.api_setup.add_and_verify')}
                  </Button>
                )}
              </div>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      <ProviderModelAddDialog
        providerId={providerId}
        open={manualModelDialogOpen}
        onClose={closeManualModelDialog}
        onSuccess={handleManualModelSuccess}
        showPurposeSelection={false}
      />
    </>
  )
}

function VerificationProgressRow({
  label,
  status,
  statusText
}: {
  label: string
  status: VerificationStepStatus
  statusText?: string
}) {
  const icon =
    status === 'complete' ? (
      <CheckCircle2 className="size-4 text-success" aria-hidden />
    ) : status === 'active' ? (
      <LoaderCircle className="size-4 text-primary motion-safe:animate-spin" aria-hidden />
    ) : status === 'error' ? (
      <CircleX className="size-4 text-error" aria-hidden />
    ) : status === 'warning' ? (
      <CircleAlert className="size-4 text-warning" aria-hidden />
    ) : (
      <Circle className="size-4 text-foreground-tertiary" aria-hidden />
    )

  return (
    <li
      aria-current={status === 'active' ? 'step' : undefined}
      aria-label={statusText ? `${label} ${statusText}` : label}
      className="flex min-h-12 items-center gap-3 px-3">
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className={cn('text-sm', status === 'pending' && 'text-muted-foreground')}>{label}</span>
    </li>
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
