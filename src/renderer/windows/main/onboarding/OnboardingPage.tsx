import {
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import AppLogo from '@renderer/assets/images/logo.png'
import { WindowControls } from '@renderer/components/WindowControls'
import { useDefaultModel, useModels } from '@renderer/hooks/useModel'
import { useProvider, useProviders } from '@renderer/hooks/useProvider'
import { appLanguageOptions, isAppLanguage } from '@renderer/i18n/languages'
import i18n from '@renderer/i18n/resolver'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { ProviderSettingsPage, useProviderModelSync } from '@renderer/pages/settings/ProviderSettings'
import { oauthWithCherryIn } from '@renderer/services/oauth'
import { toast } from '@renderer/services/toast'
import type { OnboardingProviderSetupStatus } from '@shared/data/preference/preferenceTypes'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'
import { defaultLanguage } from '@shared/utils/languages'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ArrowLeft, Check, KeyRound, Languages, LogIn } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PrivacyPolicyDialog } from '../privacy/PrivacyPolicyDialog'

type OnboardingStep = 'welcome' | 'provider' | 'select-model'
type OnboardingCompletionStatus = Exclude<OnboardingProviderSetupStatus, 'pending'>
type PrivacyProtectedAction = () => void | Promise<void>

const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'
const CHERRYIN_LOGIN_LOADING_TIMEOUT_MS = 10_000
const PESSIMISTIC_PREFERENCE_OPTIONS = { optimistic: false } as const
const isOnboardingModel = (model: Model) => model.providerId !== CHERRYAI_PROVIDER_ID
const ONBOARDING_PREFERENCE_KEYS = {
  providerSetupStatus: 'app.onboarding.provider_setup.status',
  dataCollectionEnabled: 'app.privacy.data_collection.enabled',
  policyVersion: 'app.privacy.policy_version'
} as const

function OnboardingProviderSettings() {
  const router = useMemo(() => {
    const routeTree = createRootRoute({ component: () => <ProviderSettingsPage isOnboarding /> })
    const history = createMemoryHistory({ initialEntries: ['/'] })
    return createRouter({ routeTree, history })
  }, [])

  return <RouterProvider router={router} />
}

export default function OnboardingPage() {
  const { t } = useTranslation()
  const [language, setLanguage] = usePreference('app.language')
  const [{ dataCollectionEnabled, policyVersion }, updateOnboardingPreferences] = useMultiplePreferences(
    ONBOARDING_PREFERENCE_KEYS,
    PESSIMISTIC_PREFERENCE_OPTIONS
  )
  const { addApiKey, updateProvider } = useProvider('cherryin')
  const { syncProviderModels } = useProviderModelSync('cherryin')
  const { providers: enabledProviders, isLoading: isProvidersLoading } = useProviders({ enabled: true })
  const { models: enabledModels, isLoading: isModelsLoading } = useModels({ enabled: true })
  const { defaultModel, quickModel, translateModel } = useDefaultModel()
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(true)
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false)
  const loginAttemptRef = useRef(0)
  const loginLoadingTimeoutRef = useRef<number | null>(null)
  const pendingPrivacyActionRef = useRef<PrivacyProtectedAction | null>(null)
  const canCompleteModelSetup = [defaultModel, quickModel, translateModel].every(
    (model) => model && isOnboardingModel(model)
  )
  const eligibleProviderIds = new Set(
    enabledProviders.filter((provider) => provider.id !== CHERRYAI_PROVIDER_ID).map((provider) => provider.id)
  )
  const hasEligibleProvider = eligibleProviderIds.size > 0
  const hasEligibleModel = enabledModels.some((model) => eligibleProviderIds.has(model.providerId))
  const isProviderSetupLoading = isProvidersLoading || isModelsLoading
  const canContinueProviderSetup = !isProviderSetupLoading && hasEligibleProvider && hasEligibleModel
  const providerSetupHint = !isProviderSetupLoading
    ? !hasEligibleProvider
      ? t('onboarding.provider_setup.missing_provider')
      : !hasEligibleModel
        ? t('onboarding.provider_setup.missing_model')
        : null
    : null
  const resolvedLanguage = i18n.resolvedLanguage ?? i18n.language
  const displayLanguage = isAppLanguage(language)
    ? language
    : isAppLanguage(resolvedLanguage)
      ? resolvedLanguage
      : defaultLanguage
  const displayLanguageLabel = appLanguageOptions.find((option) => option.value === displayLanguage)?.label

  const updateSeededResourceModels = useCallback(async (model: Model) => {
    const assistantUpdate = dataApiService
      .get('/assistants', { query: { limit: 2 } })
      .then(async ({ items, total }) => {
        const assistant = total === 1 ? items[0] : undefined
        if (assistant?.modelId === CHERRYAI_DEFAULT_UNIQUE_MODEL_ID) {
          await dataApiService.patch(`/assistants/${assistant.id}`, { body: { modelId: model.id } })
        }
      })
    const agentUpdate = dataApiService.get('/agents', { query: { limit: 2 } }).then(async ({ items, total }) => {
      const agent = total === 1 ? items[0] : undefined
      if (agent?.model === CHERRYAI_DEFAULT_UNIQUE_MODEL_ID) {
        await dataApiService.patch(`/agents/${agent.id}`, { body: { model: model.id } })
      }
    })

    await Promise.all([assistantUpdate, agentUpdate])
  }, [])

  const handleLanguageChange = (value: string) => {
    if (!isAppLanguage(value)) return

    void i18n.changeLanguage(value)
    void setLanguage(value)
  }

  const persistPrivacyAcceptance = useCallback(async (): Promise<boolean> => {
    setIsUpdatingPrivacy(true)
    try {
      await updateOnboardingPreferences({ policyVersion: LATEST_PRIVACY_POLICY_VERSION })
      return true
    } catch {
      toast.error(t('onboarding.privacy.update_failed'))
      return false
    } finally {
      setIsUpdatingPrivacy(false)
    }
  }, [t, updateOnboardingPreferences])

  const updatePrivacyAcceptance = useCallback(
    async (accepted: boolean): Promise<boolean> => {
      setPrivacyAccepted(accepted)
      if (accepted || policyVersion !== LATEST_PRIVACY_POLICY_VERSION) {
        return true
      }

      setIsUpdatingPrivacy(true)
      try {
        await updateOnboardingPreferences({ policyVersion: '' })
        return true
      } catch {
        setPrivacyAccepted(true)
        toast.error(t('onboarding.privacy.update_failed'))
        return false
      } finally {
        setIsUpdatingPrivacy(false)
      }
    },
    [policyVersion, t, updateOnboardingPreferences]
  )

  const handlePrivacyPolicyChoice = useCallback(
    async (accepted: boolean) => {
      if (!accepted) {
        pendingPrivacyActionRef.current = null
        if (await updatePrivacyAcceptance(false)) {
          setShowPrivacyPolicy(false)
        }
        return
      }

      setPrivacyAccepted(true)
      const pendingAction = pendingPrivacyActionRef.current
      if (!pendingAction) {
        setShowPrivacyPolicy(false)
        return
      }

      if (await persistPrivacyAcceptance()) {
        pendingPrivacyActionRef.current = null
        setShowPrivacyPolicy(false)
        await pendingAction()
      }
    },
    [persistPrivacyAcceptance, updatePrivacyAcceptance]
  )

  const complete = useCallback(
    async (status: OnboardingCompletionStatus) => {
      setIsCompleting(true)
      try {
        await updateOnboardingPreferences({
          providerSetupStatus: status,
          dataCollectionEnabled,
          policyVersion: LATEST_PRIVACY_POLICY_VERSION
        })
      } catch {
        toast.error(t('onboarding.toast.complete_failed'))
      } finally {
        setIsCompleting(false)
      }
    },
    [dataCollectionEnabled, t, updateOnboardingPreferences]
  )

  const runAfterPrivacyAcceptance = useCallback(
    async (action: PrivacyProtectedAction) => {
      if (!privacyAccepted) {
        pendingPrivacyActionRef.current = action
        setShowPrivacyPolicy(true)
        return
      }

      if (await persistPrivacyAcceptance()) {
        await action()
      }
    },
    [persistPrivacyAcceptance, privacyAccepted]
  )

  useEffect(
    () => () => {
      if (loginLoadingTimeoutRef.current !== null) {
        window.clearTimeout(loginLoadingTimeoutRef.current)
      }
    },
    []
  )

  const handleCherryInLogin = useCallback(async () => {
    const attemptId = ++loginAttemptRef.current

    if (loginLoadingTimeoutRef.current !== null) {
      window.clearTimeout(loginLoadingTimeoutRef.current)
    }

    setIsLoggingIn(true)
    loginLoadingTimeoutRef.current = window.setTimeout(() => {
      if (loginAttemptRef.current === attemptId) {
        loginLoadingTimeoutRef.current = null
        setIsLoggingIn(false)
      }
    }, CHERRYIN_LOGIN_LOADING_TIMEOUT_MS)

    try {
      await oauthWithCherryIn(
        async (apiKeys) => {
          if (loginAttemptRef.current !== attemptId) return

          const keys = apiKeys
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)

          await Promise.all(keys.map((key) => addApiKey(key, 'OAuth')))
          await updateProvider({ isEnabled: true })
        },
        { oauthServer: CHERRYIN_OAUTH_SERVER }
      )
      if (loginAttemptRef.current !== attemptId) return

      const cherryInModels = await syncProviderModels()
      if (loginAttemptRef.current !== attemptId) return

      if (!cherryInModels.some((model) => model.isEnabled)) {
        toast.error(t('onboarding.provider_setup.missing_model'))
        setStep('provider')
        return
      }
      toast.success(t('onboarding.toast.connected'))
      setStep('select-model')
    } catch {
      if (loginAttemptRef.current === attemptId) {
        toast.error(t('settings.provider.oauth.error'))
      }
    } finally {
      if (loginAttemptRef.current === attemptId) {
        if (loginLoadingTimeoutRef.current !== null) {
          window.clearTimeout(loginLoadingTimeoutRef.current)
          loginLoadingTimeoutRef.current = null
        }
        setIsLoggingIn(false)
      }
    }
  }, [addApiKey, syncProviderModels, t, updateProvider])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-sidebar text-foreground">
      <div className="drag flex h-[var(--app-top-chrome-height)] shrink-0 items-stretch justify-end">
        <div className="nodrag mr-2 flex items-center gap-1">
          <div data-onboarding-language-select="" className="nodrag">
            <Select value={displayLanguage} onValueChange={handleLanguageChange}>
              <SelectTrigger
                aria-label={t('common.language')}
                size="sm"
                className="nodrag h-7 w-auto gap-1.5 border-0 bg-transparent px-2 text-foreground-secondary text-xs shadow-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:border-transparent aria-expanded:ring-0 dark:bg-transparent [&_svg]:size-3.5 [&_svg]:opacity-60">
                <Languages className="size-3.5" />
                <SelectValue>{displayLanguageLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {appLanguageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span aria-hidden="true">{option.flag}</span>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nodrag text-foreground-secondary hover:text-foreground"
            onClick={() => void runAfterPrivacyAcceptance(() => complete('skipped'))}
            disabled={isCompleting || isUpdatingPrivacy}>
            {t('onboarding.skip')}
          </Button>
        </div>
        <WindowControls />
      </div>

      <div className="flex min-h-0 flex-1 px-2 pb-2">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border-[0.5px] border-border bg-background">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {step === 'welcome' && (
              <div className="flex h-full w-full items-center justify-center px-6 pb-20">
                <div className="flex w-full max-w-[420px] flex-col items-center">
                  <img src={AppLogo} alt="Cherry Studio" className="size-16 rounded-xl" />
                  <div className="mt-5 flex flex-col gap-2 text-center">
                    <h1 className="m-0 font-semibold text-2xl text-foreground">{t('onboarding.welcome.title')}</h1>
                    <p className="m-0 text-foreground-secondary text-sm">{t('onboarding.welcome.subtitle')}</p>
                  </div>
                  <div className="mt-8 flex w-full flex-col gap-3">
                    <Button
                      type="button"
                      size="lg"
                      className="h-11 w-full rounded-xl"
                      loading={isLoggingIn}
                      disabled={isUpdatingPrivacy}
                      onClick={() => void runAfterPrivacyAcceptance(handleCherryInLogin)}>
                      {!isLoggingIn && <LogIn size={16} />}
                      {t('onboarding.welcome.login_cherryin')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-11 w-full rounded-xl"
                      disabled={isUpdatingPrivacy}
                      onClick={() => void runAfterPrivacyAcceptance(() => setStep('provider'))}>
                      <KeyRound size={16} />
                      {t('onboarding.welcome.other_provider')}
                    </Button>
                  </div>
                  <p className="mt-4 mb-0 text-center text-foreground-muted text-xs">
                    {t('onboarding.welcome.setup_hint')}
                  </p>
                </div>
              </div>
            )}

            {step === 'provider' && (
              <div className="flex h-full min-h-0 w-full flex-col">
                <OnboardingHeader
                  title={t('onboarding.provider_setup.title')}
                  onBack={() => setStep('welcome')}
                  padded
                />
                <div className="min-h-0 flex-1 border-border border-y">
                  <OnboardingProviderSettings />
                </div>
                <div className="flex shrink-0 justify-end gap-2 px-5 py-3">
                  <Button type="button" variant="outline" onClick={() => setStep('welcome')}>
                    {t('common.back')}
                  </Button>
                  <Tooltip
                    content={providerSetupHint}
                    placement="top"
                    classNames={{
                      content:
                        'dark:bg-neutral-100 dark:text-neutral-900 dark:[&_svg]:fill-neutral-100! dark:[&_svg]:stroke-neutral-100!'
                    }}>
                    <Button
                      type="button"
                      aria-disabled={!canContinueProviderSetup}
                      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                      onClick={() => canContinueProviderSetup && setStep('select-model')}>
                      {t('onboarding.provider_setup.next')}
                    </Button>
                  </Tooltip>
                </div>
              </div>
            )}

            {step === 'select-model' && (
              <div className="flex h-full min-h-0 w-full flex-col">
                <OnboardingHeader
                  title={t('onboarding.select_model.title')}
                  onBack={() => setStep('provider')}
                  padded
                />
                <div className="flex min-h-0 flex-1 justify-center overflow-y-auto border-border border-t px-6 py-8">
                  <div className="flex w-full max-w-[440px] items-center">
                    <div className="w-full">
                      <ModelSettings
                        autoFillEmptyModels
                        onDefaultModelSelected={updateSeededResourceModels}
                        showSettingsButton={false}
                        showDescription={false}
                        showDividers={false}
                        showPaintingModel={false}
                        modelFilter={isOnboardingModel}
                        compact
                        className="mt-4 min-h-0 w-full flex-none overflow-visible"
                      />
                      <div className="mt-5 flex flex-col items-center gap-3">
                        <Button
                          type="button"
                          size="lg"
                          className="w-full"
                          loading={isCompleting}
                          disabled={!canCompleteModelSetup || isUpdatingPrivacy}
                          onClick={() => void runAfterPrivacyAcceptance(() => complete('completed'))}>
                          <Check size={16} />
                          {t('onboarding.select_model.start')}
                        </Button>
                        <p className="m-0 text-center text-foreground-muted text-xs">
                          {t('onboarding.select_model.change_later')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {step === 'welcome' && (
            <div className="nodrag flex shrink-0 justify-center px-6 py-3">
              <div className="flex max-w-full items-center gap-2 text-center text-foreground-muted text-xs leading-relaxed">
                <Checkbox
                  id="onboarding-privacy-policy"
                  size="sm"
                  checked={privacyAccepted}
                  disabled={isUpdatingPrivacy}
                  aria-label={t('onboarding.privacy.accept_policy')}
                  onCheckedChange={(checked) => void updatePrivacyAcceptance(checked === true)}
                />
                <div>
                  <span>{t('onboarding.privacy.notice')}</span>
                  <button
                    type="button"
                    className="ml-1 cursor-pointer border-0 bg-transparent p-0 text-primary text-xs hover:underline"
                    onClick={() => {
                      pendingPrivacyActionRef.current = null
                      setShowPrivacyPolicy(true)
                    }}>
                    {t('onboarding.privacy.policy')}
                  </button>
                  <span>{t('onboarding.privacy.period')}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <PrivacyPolicyDialog
        open={showPrivacyPolicy}
        onAccept={() => handlePrivacyPolicyChoice(true)}
        onDecline={() => handlePrivacyPolicyChoice(false)}
        acceptButtonText={t('onboarding.privacy.accept_and_continue')}
        isPending={isUpdatingPrivacy}
      />
    </div>
  )
}

interface OnboardingHeaderProps {
  title: string
  onBack: () => void
  padded?: boolean
}

function OnboardingHeader({ title, onBack, padded = false }: OnboardingHeaderProps) {
  return (
    <div className={padded ? 'flex shrink-0 items-center gap-3 px-5 py-4' : 'flex shrink-0 items-center gap-3 py-4'}>
      <Button type="button" variant="outline" size="icon-sm" className="shrink-0" onClick={onBack} aria-label={title}>
        <ArrowLeft size={15} />
      </Button>
      <div className="flex min-w-0 flex-1 items-center">
        <h2 className="m-0 truncate font-semibold text-base text-foreground">{title}</h2>
      </div>
    </div>
  )
}
