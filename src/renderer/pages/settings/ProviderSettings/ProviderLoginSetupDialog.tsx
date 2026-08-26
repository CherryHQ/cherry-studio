import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Tooltip } from '@cherrystudio/ui'
import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { loggerService } from '@logger'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProviderMutations } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import type { ModelServiceSetupFilter } from '@renderer/services/ModelServiceSetupService'
import { oauthWithCherryIn } from '@renderer/services/oauth'
import { cn } from '@renderer/utils/style'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import { isCodexProviderId } from '@shared/data/presets/codex'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { AlertCircle, ArrowLeft, CheckCircle2, Circle, CircleX, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { checkApi, getModelHealthCheckSkipReason } from './utils/healthCheck'
import { fetchResolvedProviderModels } from './utils/modelSync'
import { getProviderSetupErrorSummary, persistProviderModels } from './utils/providerModelSetup'

const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'
const SUCCESS_FEEDBACK_DURATION_MS = 1200
const EXTERNAL_LOGIN_POLL_INTERVAL_MS = 1000
const logger = loggerService.withContext('ProviderLoginSetupDialog')

export type ProviderLoginSetupKind = 'managed-oauth' | 'external-cli' | 'cherryin'
type SetupStep = 'login' | 'models' | 'check' | 'enable'
type StepStatus = 'pending' | 'active' | 'complete' | 'error'

interface SetupError {
  step: SetupStep
  message: string
}

interface ProviderLoginSetupDialogProps {
  provider: Provider
  kind: ProviderLoginSetupKind
  modelFilter?: ModelServiceSetupFilter
  seamlessTransitions?: boolean
  onBack: () => void
  onClose: () => void
  onCloseAutoFocus?: () => void
  onContinueToApiSetup: (step: 'api-key' | 'models') => void
  onSetupSuccess: (models: Model[]) => void
}

function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Operation cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

export default function ProviderLoginSetupDialog({
  provider,
  kind,
  modelFilter,
  seamlessTransitions = false,
  onBack,
  onClose,
  onCloseAutoFocus,
  onContinueToApiSetup,
  onSetupSuccess
}: ProviderLoginSetupDialogProps) {
  const { t } = useTranslation()
  const { models: localModels } = useModels({ providerId: provider.id })
  const { createModels, updateModels } = useModelMutations()
  const { addApiKey, enableProvider, updateProvider } = useProviderMutations(provider.id)
  const [dialogOpen, setDialogOpen] = useState(true)
  const [useDefaultDialogMotion, setUseDefaultDialogMotion] = useState(!seamlessTransitions)
  const [activeStep, setActiveStep] = useState<SetupStep | null>('login')
  const [completedSteps, setCompletedSteps] = useState<Set<SetupStep>>(() => new Set())
  const [error, setError] = useState<SetupError | null>(null)
  const [setupSucceeded, setSetupSucceeded] = useState(false)
  const closeIntentRef = useRef<'back' | 'dismiss' | 'transition'>('dismiss')
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runControllerRef = useRef<AbortController | null>(null)
  const autoStartScheduledRef = useRef(false)
  const persistedModelsRef = useRef(new Map<string, Model>())
  const oauthKeysRef = useRef(new Set<string>())
  const savedOAuthKeysRef = useRef(new Set<string>())

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => clearCloseTimer, [clearCloseTimer])
  useEffect(() => () => runControllerRef.current?.abort(), [])

  const requestExit = useCallback(
    (intent: 'back' | 'dismiss' | 'transition', callback: () => void) => {
      runControllerRef.current?.abort()
      clearCloseTimer()
      closeIntentRef.current = intent
      setUseDefaultDialogMotion(intent === 'dismiss')
      setDialogOpen(false)
      if (seamlessTransitions && intent !== 'dismiss') {
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
  const requestBack = useCallback(() => requestExit('back', onBack), [onBack, requestExit])
  const continueToApiSetup = useCallback(
    (step: 'api-key' | 'models') => requestExit('transition', () => onContinueToApiSetup(step)),
    [onContinueToApiSetup, requestExit]
  )

  useEffect(() => {
    if (!setupSucceeded) return
    const timer = setTimeout(requestClose, SUCCESS_FEEDBACK_DURATION_MS)
    return () => clearTimeout(timer)
  }, [requestClose, setupSucceeded])

  const getFallbackError = useCallback(
    (step: SetupStep) => {
      if (step === 'login') {
        if (kind === 'managed-oauth') {
          return isCodexProviderId(provider.id)
            ? t('settings.provider.codex.sign_in_failed')
            : t('settings.provider.grok_cli.sign_in_failed')
        }
        if (kind === 'external-cli') return t('settings.provider.claude_code.launch_failed')
        return t('settings.provider.oauth.error')
      }
      if (step === 'models') return t('settings.models.manage.operation_failed')
      if (step === 'check') return t('settings.provider.api_setup.check_failed')
      return t('settings.provider.api_setup.enable_failed')
    },
    [kind, provider.id, t]
  )

  const formatError = useCallback(
    (step: SetupStep, cause: unknown): SetupError => {
      const fallback = getFallbackError(step)
      const summary = getProviderSetupErrorSummary(cause, oauthKeysRef.current)
      return { step, message: summary && summary !== fallback ? `${fallback} ${summary}` : fallback }
    },
    [getFallbackError]
  )

  const completeStep = useCallback((step: SetupStep) => {
    setCompletedSteps((current) => new Set(current).add(step))
  }, [])

  const signInManagedOAuth = useCallback(
    async (signal: AbortSignal) => {
      if (await ipcApi.request('oauth.has_token', { providerId: provider.id })) return
      signal.throwIfAborted()

      const requestId = crypto.randomUUID()
      const cancel = () => {
        void ipcApi
          .request('oauth.cancel_sign_in', { providerId: provider.id, requestId })
          .catch((cause) => logger.warn('Failed to cancel provider sign-in', cause as Error))
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await ipcApi.request('oauth.sign_in', { providerId: provider.id, requestId })
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
    [provider.id]
  )

  const signInExternalCli = useCallback(
    async (signal: AbortSignal) => {
      if (await ipcApi.request('oauth.check_external_login', { providerId: provider.id })) return
      signal.throwIfAborted()

      const { homePath } = await ipcApi.request('app.get_info')
      const result = await ipcApi.request('code_cli.run', {
        mode: 'login-flow',
        cliTool: CodeCli.CLAUDE_CODE,
        directory: homePath
      })
      if (!result.success) throw new Error(result.message)

      while (!signal.aborted) {
        await waitForDelay(EXTERNAL_LOGIN_POLL_INTERVAL_MS, signal)
        if (await ipcApi.request('oauth.check_external_login', { providerId: provider.id })) return
      }
      signal.throwIfAborted()
    },
    [provider.id]
  )

  const signInCherryIn = useCallback(
    async (signal: AbortSignal) => {
      await oauthWithCherryIn(
        async (apiKeys) => {
          const keys = apiKeys
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)

          for (const key of keys) {
            oauthKeysRef.current.add(key)
            if (savedOAuthKeysRef.current.has(key)) continue
            await addApiKey(key, 'OAuth')
            savedOAuthKeysRef.current.add(key)
          }
        },
        { oauthServer: CHERRYIN_OAUTH_SERVER, signal }
      )
    },
    [addApiKey]
  )

  const createCompatibleModels = useCallback(
    async (signal: AbortSignal): Promise<Model[]> => {
      const fetchedModels = await fetchResolvedProviderModels(provider.id)
      signal.throwIfAborted()
      const compatibleModels = fetchedModels.filter((model) => modelFilter?.(model, provider) ?? true)
      if (compatibleModels.length === 0) {
        throw new Error(t('settings.provider.api_setup.no_compatible_models'))
      }

      return persistProviderModels({
        provider,
        selectedModels: compatibleModels,
        localModels,
        knownModels: persistedModelsRef.current.values(),
        createModels,
        updateModels,
        signal,
        onPersisted: (models) => {
          for (const model of models) persistedModelsRef.current.set(model.id, model)
        }
      })
    },
    [createModels, localModels, modelFilter, provider, t, updateModels]
  )

  const startSetup = useCallback(async () => {
    runControllerRef.current?.abort()
    const controller = new AbortController()
    runControllerRef.current = controller
    const { signal } = controller
    let currentStep: SetupStep = 'login'

    setError(null)
    setSetupSucceeded(false)
    setCompletedSteps(new Set())
    setActiveStep('login')

    try {
      if (provider.isEnabled) await updateProvider({ isEnabled: false })
      signal.throwIfAborted()

      if (kind === 'managed-oauth') await signInManagedOAuth(signal)
      else if (kind === 'external-cli') await signInExternalCli(signal)
      else await signInCherryIn(signal)
      signal.throwIfAborted()
      completeStep('login')

      if (kind === 'cherryin') {
        continueToApiSetup('models')
        return
      }

      currentStep = 'models'
      setActiveStep('models')
      const configuredModels = await createCompatibleModels(signal)
      completeStep('models')

      if (!isClaudeCodeProviderId(provider.id)) {
        currentStep = 'check'
        setActiveStep('check')
        const probeModel = configuredModels.find((model) => getModelHealthCheckSkipReason(model) === null)
        if (!probeModel) throw new Error(t('settings.provider.api_setup.manual_description'))
        await checkApi(probeModel.id, { timeout: 15000, signal })
        completeStep('check')
      }

      signal.throwIfAborted()
      currentStep = 'enable'
      setActiveStep('enable')
      await enableProvider()
      completeStep('enable')
      setActiveStep(null)
      onSetupSuccess(configuredModels)
      setSetupSucceeded(true)
    } catch (cause) {
      if (signal.aborted) return
      setActiveStep(null)
      setError(formatError(currentStep, cause))
    }
  }, [
    completeStep,
    continueToApiSetup,
    createCompatibleModels,
    enableProvider,
    formatError,
    kind,
    onSetupSuccess,
    provider.id,
    provider.isEnabled,
    signInCherryIn,
    signInExternalCli,
    signInManagedOAuth,
    t,
    updateProvider
  ])

  useEffect(() => {
    if (autoStartScheduledRef.current) return
    const timer = setTimeout(() => {
      autoStartScheduledRef.current = true
      void startSetup()
    }, 0)
    return () => clearTimeout(timer)
  }, [startSetup])

  const steps = useMemo(() => {
    if (kind === 'cherryin') {
      return [{ id: 'login' as const, label: t('settings.provider.model_service_setup.progress.sign_in') }]
    }
    return [
      { id: 'login' as const, label: t('settings.provider.model_service_setup.progress.sign_in') },
      { id: 'models' as const, label: t('settings.provider.model_service_setup.progress.add_models') },
      ...(kind === 'managed-oauth'
        ? [{ id: 'check' as const, label: t('settings.provider.api_setup.progress.check_model') }]
        : []),
      { id: 'enable' as const, label: t('settings.provider.api_setup.progress.enable_provider') }
    ]
  }, [kind, t])

  const statusMessage = setupSucceeded
    ? t('settings.provider.api_setup.success')
    : (error?.message ??
      (activeStep === 'login'
        ? t(
            kind === 'external-cli'
              ? 'settings.provider.model_service_setup.status.waiting_external_login'
              : 'settings.provider.model_service_setup.status.waiting_sign_in'
          )
        : activeStep === 'models'
          ? t('settings.provider.model_service_setup.status.adding_models')
          : activeStep === 'check'
            ? t('settings.provider.api_setup.progress.check_model')
            : activeStep === 'enable'
              ? t('settings.provider.api_setup.status.enabling_provider')
              : t('common.loading')))

  return (
    <Dialog open={dialogOpen} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
      <DialogContent
        size="lg"
        aria-describedby={undefined}
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
        className="gap-5">
        {setupSucceeded ? (
          <DialogTitle className="sr-only">{t('settings.provider.api_setup.success')}</DialogTitle>
        ) : (
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Tooltip content={t('settings.provider.api_setup.back_to_providers')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('settings.provider.api_setup.back_to_providers')}
                  onClick={requestBack}>
                  <ArrowLeft className="size-4" />
                </Button>
              </Tooltip>
              <DialogTitle>{provider.name}</DialogTitle>
            </div>
          </DialogHeader>
        )}

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
                    : 'bg-primary/10 text-primary'
              )}>
              {setupSucceeded ? (
                <CheckCircle2 className="size-5" aria-hidden />
              ) : error ? (
                <CircleX className="size-5" aria-hidden />
              ) : (
                <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden />
              )}
            </div>
            <div className="max-w-md text-sm leading-6">{statusMessage}</div>
          </div>

          <ol className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {steps.map(({ id, label }) => {
              const status: StepStatus = completedSteps.has(id)
                ? 'complete'
                : error?.step === id
                  ? 'error'
                  : activeStep === id
                    ? 'active'
                    : 'pending'
              return <SetupProgressRow key={id} label={label} status={status} />
            })}
          </ol>

          {error ? (
            <div className="flex justify-center">
              <Button type="button" onClick={() => void startSetup()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : null}

          {kind === 'cherryin' && !setupSucceeded ? (
            <Button type="button" variant="outline" className="w-full" onClick={() => continueToApiSetup('api-key')}>
              {t('settings.provider.oauth.cherryIn.use_api_key')}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SetupProgressRow({ label, status }: { label: string; status: StepStatus }) {
  const icon =
    status === 'complete' ? (
      <CheckCircle2 className="size-4 text-success" aria-hidden />
    ) : status === 'active' ? (
      <LoaderCircle className="size-4 text-primary motion-safe:animate-spin" aria-hidden />
    ) : status === 'error' ? (
      <AlertCircle className="size-4 text-error" aria-hidden />
    ) : (
      <Circle className="size-4 text-foreground-tertiary" aria-hidden />
    )

  return (
    <li aria-current={status === 'active' ? 'step' : undefined} className="flex min-h-12 items-center gap-3 px-3">
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className={cn('text-sm', status === 'pending' && 'text-muted-foreground')}>{label}</span>
    </li>
  )
}
