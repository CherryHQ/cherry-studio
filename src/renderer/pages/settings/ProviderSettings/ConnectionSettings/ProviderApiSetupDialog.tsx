import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NormalTooltip,
  Tooltip
} from '@cherrystudio/ui'
import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { joinApiKeyString } from '@renderer/utils/api'
import { cn } from '@renderer/utils/style'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleX,
  Eye,
  EyeOff,
  LoaderCircle
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderAvatar } from '../components/ProviderAvatar'
import { mergeProviderApiKeyEntries, parseProviderApiKeys } from '../hooks/providerSetting/useProviderApiKey'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import {
  ModelListSyncContent,
  ProviderModelAddDialog,
  useModelListSyncView,
  useProviderModelPullReconcile
} from '../ModelList'
import { ProviderHelpLink, providerListClasses } from '../primitives/ProviderSettingsPrimitives'
import { checkApi, getModelHealthCheckSkipReason } from '../utils/healthCheck'
import { getProviderSetupErrorDetails, persistProviderModels } from '../utils/providerModelSetup'

const VERIFICATION_STEP_FEEDBACK_DURATION_MS = 400

export type ProviderApiSetupInitialStep = 'api-key' | 'models'
type ProviderApiSetupStep = ProviderApiSetupInitialStep | 'verification'

interface ProviderApiSetupDialogProps {
  providerId: string
  initialStep: ProviderApiSetupInitialStep
  onClose: () => void
}

type SetupBusyState =
  | 'saving-key-close'
  | 'saving-key-next'
  | 'loading-models'
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

export default function ProviderApiSetupDialog({ providerId, initialStep, onClose }: ProviderApiSetupDialogProps) {
  const { t } = useTranslation()
  const { provider, updateApiKeys, updateProvider, enableProvider } = useProvider(providerId)
  const providerMeta = useProviderMeta(providerId)
  const { data: apiKeysData, isLoading: isLoadingApiKeys } = useProviderApiKeys(providerId)
  const { createModels, updateModels } = useModelMutations()
  const {
    allModels: availableModels,
    localModels,
    reloadModels,
    isLoadingModels
  } = useProviderModelPullReconcile(providerId)
  const [step, setStep] = useState<ProviderApiSetupStep>(initialStep)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [savedApiKeyEntries, setSavedApiKeyEntries] = useState<ApiKeyEntry[] | null>(null)
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
  const initializedRef = useRef(false)
  const apiKeyInputInitializedRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistedModelsRef = useRef(new Map<UniqueModelId, Model>())
  const modelsPersistedRef = useRef(false)
  const probeSucceededModelIdRef = useRef<string | null>(null)

  const isBusy = busyState !== null
  const isModelListLoading = busyState === 'loading-models' || isLoadingModels
  const canDismissDialog = !isBusy || busyState === 'loading-models'
  const providerDisplayName = providerMeta.fancyProviderName || provider?.name || ''
  const setupStepTitle = t(
    step === 'api-key'
      ? 'settings.provider.api_setup.add_key'
      : step === 'verification'
        ? 'settings.provider.api_setup.verify_and_enable'
        : 'settings.provider.api_setup.models_title'
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
  const storedApiKeyEntries = useMemo(
    () => savedApiKeyEntries ?? apiKeysData?.keys ?? [],
    [apiKeysData?.keys, savedApiKeyEntries]
  )
  const storedApiKey = storedApiKeyEntries.find((entry) => entry.isEnabled)
  const hasStoredApiKey = storedApiKey !== undefined
  const hasOnlyDisabledApiKeys = storedApiKeyEntries.length > 0 && !hasStoredApiKey
  const verificationApiKey = parseProviderApiKeys(apiKey)[0] || storedApiKey?.key || ''
  const hasBlockingModelError = error?.kind === 'models' && availableModels.length === 0
  const activeVerificationStep: VerificationStep | null =
    busyState === 'checking' ? 'check' : busyState === 'enabling' ? 'enable' : null
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
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) {
      return
    }

    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  useEffect(() => {
    if (
      initialStep !== 'api-key' ||
      isLoadingApiKeys ||
      apiKeysData === undefined ||
      apiKeyInputInitializedRef.current
    ) {
      return
    }

    apiKeyInputInitializedRef.current = true
    setApiKey(joinApiKeyString(storedApiKeyEntries.filter((entry) => entry.isEnabled).map((entry) => entry.key)))
  }, [apiKeysData, initialStep, isLoadingApiKeys, storedApiKeyEntries])

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
      const details = getProviderSetupErrorDetails(cause, [
        ...parseProviderApiKeys(apiKey),
        ...storedApiKeyEntries.map((entry) => entry.key)
      ])
      const summary = details.i18nKey ? t(details.i18nKey) : canSafelyShowSummary ? details.summary : ''
      return { kind, message: summary ? `${fallback} ${summary}` : fallback }
    },
    [apiKey, apiKeysData?.keys, storedApiKeyEntries, t]
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
    modelsPersistedRef.current = false
    probeSucceededModelIdRef.current = null

    try {
      await keepProviderDisabled()
      const result = await reloadModels()
      if (!result) {
        return
      }
      if (result.error) {
        setError(createError('models', 'settings.models.manage.sync_pull_failed', result.error))
      } else if (result.models.length === 0 && localModelIds.size === 0) {
        setError({ kind: 'models', message: t('settings.provider.api_setup.no_models') })
      }
    } catch (cause) {
      setSelectedModelIds(new Set())
      setError(createError('models', 'settings.models.manage.sync_pull_failed', cause))
    } finally {
      setBusyState(null)
    }
  }, [createError, keepProviderDisabled, localModelIds, reloadModels, t])

  useEffect(() => {
    if (pendingManualModelIds.length === 0) {
      return
    }

    const pendingIdSet = new Set(pendingManualModelIds)
    const addedModels = localModels.filter((model) => pendingIdSet.has(model.id))
    if (addedModels.length !== pendingManualModelIds.length) {
      return
    }

    setError(null)
    setSelectedModelIds((current) => new Set([...current, ...addedModels.map((model) => model.id)]))
    setPendingManualModelIds([])
    setModelViewResetVersion((version) => version + 1)
  }, [localModels, pendingManualModelIds])

  useEffect(() => {
    if (initializedRef.current || initialStep !== 'models' || isLoadingApiKeys) {
      return
    }

    initializedRef.current = true
    if (hasOnlyDisabledApiKeys) {
      setStep('api-key')
      return
    }
    void loadModels()
  }, [hasOnlyDisabledApiKeys, initialStep, isLoadingApiKeys, loadModels])

  const saveApiKey = useCallback(
    async (action: 'close' | 'next') => {
      const parsedApiKeys = parseProviderApiKeys(apiKey)
      if (parsedApiKeys.length === 0 || isBusy) {
        return
      }

      setBusyState(action === 'close' ? 'saving-key-close' : 'saving-key-next')
      setError(null)
      try {
        await keepProviderDisabled()
        if (parsedApiKeys.some((key) => [...key].some((character) => character.charCodeAt(0) > 0xff))) {
          throw new Error('API key contains characters unsupported by HTTP headers')
        }

        const nextEntries = mergeProviderApiKeyEntries(apiKey, storedApiKeyEntries)
        await updateApiKeys(nextEntries)
        setSavedApiKeyEntries(nextEntries)
        setApiKey(joinApiKeyString(parsedApiKeys))

        if (action === 'close') {
          requestClose()
          return
        }

        setStep('models')
        await loadModels()
      } catch (cause) {
        setError(createError('api-key', 'settings.provider.api_key.save_failed', cause))
      } finally {
        setBusyState(null)
      }
    },
    [apiKey, createError, isBusy, keepProviderDisabled, loadModels, requestClose, storedApiKeyEntries, updateApiKeys]
  )

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

  const addSelectedModels = useCallback(async () => {
    if (!provider || selectedModels.length === 0 || isBusy) {
      return
    }

    setBusyState('creating-models')
    setError(null)
    setRequiresManualConfirmation(false)
    setSetupSucceeded(false)
    setCompletedVerificationSteps(new Set())
    modelsPersistedRef.current = false
    probeSucceededModelIdRef.current = null

    try {
      await keepProviderDisabled()
      await persistProviderModels({
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
      modelsPersistedRef.current = true
    } catch (cause) {
      setBusyState(null)
      setError(createError('create', 'settings.models.manage.operation_failed', cause))
      return
    }

    setCompletedVerificationSteps(new Set(['models']))
    if (!probeModel) {
      setRequiresManualConfirmation(true)
    }
    setBusyState(null)
    setStep('verification')
  }, [
    createError,
    createModels,
    isBusy,
    keepProviderDisabled,
    localModels,
    probeModel,
    provider,
    selectedModels,
    updateModels
  ])

  const verifyAndEnable = useCallback(async () => {
    if (!probeModel || !modelsPersistedRef.current || isBusy) {
      return
    }

    setError(null)
    setRequiresManualConfirmation(false)
    setSetupSucceeded(false)

    const shouldCheckModel = probeSucceededModelIdRef.current !== probeModel.id
    if (shouldCheckModel) {
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
    if (shouldCheckModel) {
      await new Promise((resolve) => setTimeout(resolve, VERIFICATION_STEP_FEEDBACK_DURATION_MS))
    }

    setBusyState('enabling')
    try {
      await enableProvider()
      setCompletedVerificationSteps((current) => new Set(current).add('enable'))
      setBusyState(null)
      setSetupSucceeded(true)
    } catch (cause) {
      setBusyState(null)
      setError(createError('enable', 'settings.provider.api_setup.enable_failed', cause))
    }
  }, [createError, enableProvider, isBusy, probeModel, verificationApiKey])

  const returnToModels = useCallback(() => {
    if (isBusy) {
      return
    }

    setError(null)
    setRequiresManualConfirmation(false)
    setSetupSucceeded(false)
    setCompletedVerificationSteps(new Set())
    modelsPersistedRef.current = false
    probeSucceededModelIdRef.current = null
    setStep('models')
  }, [isBusy])

  const handleManualModelSuccess = useCallback((modelIds: UniqueModelId[]) => {
    setManualModelDialogOpen(false)
    setPendingManualModelIds(modelIds)
  }, [])

  const openManualModelDialog = useCallback(() => setManualModelDialogOpen(true), [])

  const closeManualModelDialog = useCallback(() => setManualModelDialogOpen(false), [])

  const editSavedKey = useCallback(() => {
    setError(null)
    setRequiresManualConfirmation(false)
    setSetupSucceeded(false)
    setCompletedVerificationSteps(new Set())
    modelsPersistedRef.current = false
    probeSucceededModelIdRef.current = null
    setShowApiKey(false)
    setApiKey(
      (current) =>
        current || joinApiKeyString(storedApiKeyEntries.filter((entry) => entry.isEnabled).map((entry) => entry.key))
    )
    setStep('api-key')
  }, [storedApiKeyEntries])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && canDismissDialog) {
        requestClose()
      }
    },
    [canDismissDialog, requestClose]
  )
  const headerBackAction =
    step === 'verification' && !setupSucceeded
      ? {
          label: t('settings.provider.api_setup.back_to_models'),
          disabled: isBusy,
          onClick: returnToModels
        }
      : step === 'models' && hasStoredApiKey
        ? {
            label: t('common.back'),
            disabled: isBusy,
            onClick: editSavedKey
          }
        : null

  return (
    <>
      <Dialog open={dialogOpen && !manualModelDialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          closeOnOverlayClick={canDismissDialog}
          showCloseButton={step !== 'verification' || !isBusy}
          size="lg"
          className={cn(
            'gap-5 transition-[height] duration-150 ease-out [interpolate-size:allow-keywords] motion-reduce:transition-none [&_[data-slot=dialog-close]]:top-7',
            step === 'models' &&
              !isModelListLoading &&
              !hasBlockingModelError &&
              availableModels.length > 0 &&
              'h-[min(720px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto]'
          )}>
          <DialogHeader className="pr-8">
            <div className="flex min-w-0 items-center gap-2">
              {headerBackAction ? (
                <Tooltip content={headerBackAction.label}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={headerBackAction.label}
                    disabled={headerBackAction.disabled}
                    onClick={headerBackAction.onClick}>
                    <ArrowLeft className="size-4" />
                  </Button>
                </Tooltip>
              ) : null}
              {provider && providerDisplayName ? (
                <ProviderAvatar
                  provider={{ ...provider, name: providerDisplayName }}
                  size={24}
                  className={providerListClasses.itemAvatar}
                  displayContext="provider-list"
                />
              ) : null}
              <DialogTitle className="flex min-w-0 items-baseline gap-2">
                {providerDisplayName ? (
                  <>
                    <span className="min-w-0 truncate font-normal text-base">{providerDisplayName}</span>
                    <span className="shrink-0 font-normal text-muted-foreground text-sm">· {setupStepTitle}</span>
                  </>
                ) : (
                  setupStepTitle
                )}
              </DialogTitle>
            </div>
          </DialogHeader>

          {step === 'api-key' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    autoFocus
                    type={showApiKey ? 'text' : 'password'}
                    className="pr-10"
                    value={apiKey}
                    disabled={isBusy}
                    spellCheck={false}
                    placeholder={t('settings.provider.api_setup.keys_placeholder')}
                    aria-label={t('settings.provider.api_key.label')}
                    onChange={(event) => {
                      apiKeyInputInitializedRef.current = true
                      setApiKey(event.target.value)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && parseProviderApiKeys(apiKey).length > 0) {
                        event.preventDefault()
                        void saveApiKey('next')
                      }
                    }}
                  />
                  <NormalTooltip
                    content={
                      showApiKey ? t('settings.provider.api_key.hide_key') : t('settings.provider.api_key.show_key')
                    }>
                    <button
                      type="button"
                      className="-translate-y-1/2 absolute top-1/2 right-2 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                      aria-label={
                        showApiKey ? t('settings.provider.api_key.hide_key') : t('settings.provider.api_key.show_key')
                      }
                      onClick={() => setShowApiKey((value) => !value)}>
                      {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </NormalTooltip>
                </div>
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
              {isModelListLoading ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex min-h-12 items-center justify-center gap-2 text-muted-foreground text-sm">
                  <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                  {t('common.loading')}
                </div>
              ) : hasBlockingModelError ? (
                <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full shrink-0"
                    disabled={isBusy}
                    onClick={openManualModelDialog}>
                    {t('settings.provider.api_setup.add_model_manually')}
                  </Button>
                  <SetupErrorMessage message={error.message} />
                </div>
              ) : (
                <ModelListSyncContent
                  mode="select"
                  provider={provider}
                  view={modelListView}
                  localModelIds={localModelIds}
                  selectedModelIds={selectedModelIds}
                  isLoading={isModelListLoading}
                  isApplying={isBusy}
                  hideEmptyFilters
                  flattenSingleGroup
                  onSelectModels={setModelSelection}
                  toolbarAction={
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={modelListView.filteredModels.length === 0 || isBusy}
                      onClick={toggleAllFiltered}>
                      {t(allFilteredSelected ? 'settings.provider.api_setup.deselect_all' : 'common.select_all')}
                    </Button>
                  }
                />
              )}

              {error && !hasBlockingModelError ? (
                <SetupErrorMessage
                  message={error.message}
                  className={
                    error.kind === 'models'
                      ? 'border-warning-border bg-warning-subtle text-warning-subtle-foreground'
                      : undefined
                  }
                />
              ) : null}
            </div>
          ) : (
            <ol className="space-y-1 px-1">
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

                const description =
                  status === 'error'
                    ? error?.message
                    : status === 'warning'
                      ? t('settings.provider.api_setup.manual_description')
                      : undefined

                return (
                  <VerificationProgressRow
                    key={id}
                    label={label}
                    status={status}
                    statusText={statusText}
                    description={description}
                  />
                )
              })}
            </ol>
          )}

          {step === 'verification' ? (
            !requiresManualConfirmation ? (
              <DialogFooter className="flex-row items-center justify-end sm:justify-end">
                {setupSucceeded ? (
                  <Button type="button" onClick={requestClose}>
                    {t('settings.provider.api_setup.done')}
                  </Button>
                ) : (
                  <>
                    {error && hasStoredApiKey ? (
                      <Button type="button" variant="ghost" disabled={isBusy} onClick={editSavedKey}>
                        {t('settings.provider.api_setup.edit_key')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      loading={isBusy}
                      disabled={!probeModel}
                      onClick={() => void verifyAndEnable()}>
                      {t('settings.provider.api_setup.verify_and_enable')}
                    </Button>
                  </>
                )}
              </DialogFooter>
            ) : null
          ) : (
            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              <div>
                {step === 'api-key' ? (
                  <Button
                    type="button"
                    variant="outline"
                    loading={busyState === 'saving-key-close'}
                    disabled={parseProviderApiKeys(apiKey).length === 0 || isBusy}
                    onClick={() => void saveApiKey('close')}>
                    {t('settings.provider.api_setup.save_and_close')}
                  </Button>
                ) : step === 'models' && hasStoredApiKey ? (
                  <Button type="button" variant="ghost" disabled={isBusy} onClick={editSavedKey}>
                    {t('settings.provider.api_setup.edit_key')}
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {step === 'api-key' ? (
                  <Button
                    type="button"
                    loading={busyState === 'saving-key-next'}
                    disabled={parseProviderApiKeys(apiKey).length === 0 || isBusy}
                    onClick={() => void saveApiKey('next')}>
                    {t('settings.provider.api_setup.next')}
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" disabled={!canDismissDialog} onClick={requestClose}>
                      {t('settings.provider.api_setup.skip')}
                    </Button>
                    {hasBlockingModelError ? (
                      <Button type="button" disabled={isBusy} onClick={() => void loadModels()}>
                        {t('common.retry')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        loading={busyState === 'creating-models'}
                        disabled={selectedModels.length === 0 || isBusy}
                        onClick={() => void addSelectedModels()}>
                        {t('settings.provider.api_setup.progress.add_models')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </DialogFooter>
          )}
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
  statusText,
  description
}: {
  label: string
  status: VerificationStepStatus
  statusText?: string
  description?: string
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
      className="flex min-h-11 items-start gap-3 px-1.5 py-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className={cn('min-w-0 flex-1 text-sm', status === 'pending' && 'text-muted-foreground')}>{label}</span>
          {statusText && status !== 'complete' ? (
            <span
              role={status === 'active' || status === 'warning' ? 'status' : undefined}
              className={cn(
                'shrink-0 text-xs',
                status === 'active' && 'text-primary',
                status === 'error' && 'text-error',
                status === 'warning' && 'text-warning'
              )}>
              {statusText}
            </span>
          ) : null}
        </div>
        {description ? (
          <div
            role={status === 'error' ? 'alert' : undefined}
            className={cn(
              'mt-1 break-words text-xs leading-5',
              status === 'error' ? 'text-error' : 'text-muted-foreground'
            )}>
            {description}
          </div>
        ) : null}
      </div>
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
