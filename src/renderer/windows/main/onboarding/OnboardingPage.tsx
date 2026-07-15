import { Button, Tooltip } from '@cherrystudio/ui'
import AppLogo from '@renderer/assets/images/logo.png'
import { WindowControls } from '@renderer/components/WindowControls'
import { useDefaultModel, useModels } from '@renderer/hooks/useModel'
import { useProvider, useProviders } from '@renderer/hooks/useProvider'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { ProviderSettingsPage } from '@renderer/pages/settings/ProviderSettings'
import { oauthWithCherryIn } from '@renderer/services/oauth'
import { toast } from '@renderer/services/toast'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ArrowLeft, Check, KeyRound, LogIn } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type OnboardingStep = 'welcome' | 'provider' | 'select-model'

interface OnboardingPageProps {
  onComplete: () => void | Promise<void>
}

const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'

function OnboardingProviderSettings() {
  const router = useMemo(() => {
    const routeTree = createRootRoute({ component: () => <ProviderSettingsPage isOnboarding /> })
    const history = createMemoryHistory({ initialEntries: ['/'] })
    return createRouter({ routeTree, history })
  }, [])

  return <RouterProvider router={router} />
}

export default function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const { t } = useTranslation()
  const { addApiKey, updateProvider } = useProvider('cherryin')
  const { providers: enabledProviders, isLoading: isProvidersLoading } = useProviders({ enabled: true })
  const { models: enabledModels, isLoading: isModelsLoading } = useModels({ enabled: true })
  const { defaultModel, quickModel, translateModel } = useDefaultModel()
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const canCompleteModelSetup = Boolean(defaultModel && quickModel && translateModel)
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

  const complete = useCallback(async () => {
    setIsCompleting(true)
    try {
      await onComplete()
    } catch {
      toast.error(t('onboarding.toast.complete_failed'))
    } finally {
      setIsCompleting(false)
    }
  }, [onComplete, t])

  const handleCherryInLogin = useCallback(async () => {
    setIsLoggingIn(true)
    try {
      await oauthWithCherryIn(
        async (apiKeys) => {
          const keys = apiKeys
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)

          await Promise.all(keys.map((key) => addApiKey(key, 'OAuth')))
          await updateProvider({ isEnabled: true })
        },
        { oauthServer: CHERRYIN_OAUTH_SERVER }
      )
      toast.success(t('onboarding.toast.connected'))
      setStep('select-model')
    } catch {
      toast.error(t('settings.provider.oauth.error'))
    } finally {
      setIsLoggingIn(false)
    }
  }, [addApiKey, t, updateProvider])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-sidebar text-foreground">
      <div className="drag flex h-10 shrink-0 items-stretch justify-end">
        <div className="nodrag mr-2 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nodrag text-muted-foreground"
            onClick={() => void complete()}
            disabled={isCompleting}>
            {t('onboarding.skip')}
          </Button>
        </div>
        <WindowControls />
      </div>

      <div className="flex min-h-0 flex-1 px-2 pb-2">
        <section className="relative flex min-h-0 flex-1 overflow-hidden rounded-[12px] border-[0.5px] border-border bg-background">
          {step === 'welcome' && (
            <div className="flex h-full w-full items-center justify-center px-6">
              <div className="flex w-full max-w-[420px] flex-col items-center gap-6">
                <img src={AppLogo} alt="Cherry Studio" className="size-16 rounded-xl" />
                <div className="space-y-2 text-center">
                  <h1 className="m-0 font-semibold text-2xl text-foreground">{t('onboarding.welcome.title')}</h1>
                  <p className="m-0 text-foreground-muted text-sm">{t('onboarding.welcome.subtitle')}</p>
                </div>
                <div className="flex w-full flex-col gap-3">
                  <Button
                    type="button"
                    size="lg"
                    className="h-11 w-full"
                    loading={isLoggingIn}
                    onClick={() => void handleCherryInLogin()}>
                    <LogIn size={16} />
                    {t('onboarding.welcome.login_cherryin')}
                  </Button>
                  <div className="flex items-center gap-3 text-foreground-muted text-xs">
                    <div className="h-px flex-1 bg-border" />
                    <span>{t('onboarding.welcome.or_continue_with')}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-11 w-full"
                    onClick={() => setStep('provider')}>
                    <KeyRound size={16} />
                    {t('onboarding.welcome.other_provider')}
                  </Button>
                </div>
                <p className="m-0 text-center text-foreground-muted text-xs">{t('onboarding.welcome.setup_hint')}</p>
              </div>
            </div>
          )}

          {step === 'provider' && (
            <div className="flex h-full min-h-0 w-full flex-col">
              <OnboardingHeader title={t('onboarding.provider_setup.title')} onBack={() => setStep('welcome')} padded />
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
              <OnboardingHeader title={t('onboarding.select_model.title')} onBack={() => setStep('provider')} padded />
              <div className="flex min-h-0 flex-1 justify-center overflow-y-auto border-border border-t px-6 py-8">
                <div className="flex w-full max-w-[440px] items-center">
                  <div className="w-full">
                    <ModelSettings
                      showSettingsButton={false}
                      showDescription={false}
                      showDividers={false}
                      compact
                      className="mt-4 min-h-0 w-full flex-none overflow-visible"
                    />
                    <div className="mt-5 flex flex-col items-center gap-3">
                      <Button
                        type="button"
                        size="lg"
                        className="w-full"
                        loading={isCompleting}
                        disabled={!canCompleteModelSetup}
                        onClick={() => void complete()}>
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
        </section>
      </div>
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
