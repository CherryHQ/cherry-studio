import { Button, Input, Slider, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCopilot } from '@renderer/hooks/useCopilot'
import { useProvider } from '@renderer/hooks/useProvider'
import { cn } from '@renderer/utils'
import { CheckCircle2, CircleAlert, Copy } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderSettingsSubtitle } from '../primitives/ProviderSettingsPrimitives'

const logger = loggerService.withContext('GithubCopilotSettings')

interface GithubCopilotSettingsProps {
  providerId: string
}

enum AuthStatus {
  NOT_STARTED,
  CODE_GENERATED,
  AUTHENTICATED
}

const GithubCopilotSettings: FC<GithubCopilotSettingsProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider, addApiKey, deleteApiKey } = useProvider(providerId)
  const { username, avatar, defaultHeaders, updateState } = useCopilot()

  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.NOT_STARTED)
  const [deviceCode, setDeviceCode] = useState<string>('')
  const [userCode, setUserCode] = useState<string>('')
  const [verificationUri, setVerificationUri] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [verificationPageOpened, setVerificationPageOpened] = useState<boolean>(false)
  const [currentStep, setCurrentStep] = useState<number>(0)

  const providerRateLimit = provider?.settings?.rateLimit ?? 10
  const rateLimitRef = useRef(providerRateLimit)
  const [rateLimit, setRateLimit] = useState(providerRateLimit)

  useEffect(() => {
    if (provider?.settings?.isAuthed) {
      setAuthStatus(AuthStatus.AUTHENTICATED)
      setCurrentStep(3)
    } else {
      setAuthStatus(AuthStatus.NOT_STARTED)
      setCurrentStep(0)
      setDeviceCode('')
      setUserCode('')
      setVerificationUri('')
      setVerificationPageOpened(false)
    }
  }, [provider?.settings?.isAuthed])

  useEffect(() => {
    setRateLimit(providerRateLimit)
    rateLimitRef.current = providerRateLimit
  }, [providerRateLimit])

  const handleGetDeviceCode = useCallback(async () => {
    try {
      setLoading(true)
      setCurrentStep(1)
      const { device_code, user_code, verification_uri } = await window.api.copilot.getAuthMessage(defaultHeaders)
      logger.debug('device_code', device_code)
      logger.debug('user_code', user_code)
      logger.debug('verification_uri', verification_uri)
      setDeviceCode(device_code)
      setUserCode(user_code)
      setVerificationUri(verification_uri)
      setAuthStatus(AuthStatus.CODE_GENERATED)

      try {
        await navigator.clipboard.writeText(user_code)
        window.toast.success(t('settings.provider.copilot.code_copied'))
      } catch (error) {
        logger.error('Failed to copy to clipboard:', error as Error)
      }
    } catch (error) {
      logger.error('Failed to get device code:', error as Error)
      window.toast.error(t('settings.provider.copilot.code_failed'))
      setCurrentStep(0)
    } finally {
      setLoading(false)
    }
  }, [t, defaultHeaders])

  const handleGetToken = useCallback(async () => {
    try {
      setLoading(true)
      setCurrentStep(3)
      const { access_token } = await window.api.copilot.getCopilotToken(deviceCode, defaultHeaders)

      await window.api.copilot.saveCopilotToken(access_token)
      const { token } = await window.api.copilot.getToken(defaultHeaders)

      if (token) {
        const { login, avatar: userAvatar } = await window.api.copilot.getUser(access_token)
        setAuthStatus(AuthStatus.AUTHENTICATED)

        await addApiKey(token, 'Copilot')
        await updateProvider({
          isEnabled: true,
          providerSettings: {
            ...provider?.settings,
            isAuthed: true,
            oauthUsername: login,
            oauthAvatar: userAvatar
          }
        })

        updateState({ username: login, avatar: userAvatar })
        window.toast.success(t('settings.provider.copilot.auth_success'))
      }
    } catch (error) {
      logger.error('Failed to get token:', error as Error)
      window.toast.error(t('settings.provider.copilot.auth_failed'))
      setCurrentStep(2)
    } finally {
      setLoading(false)
    }
  }, [deviceCode, t, provider?.settings, addApiKey, updateProvider, updateState, defaultHeaders])

  const handleLogout = useCallback(async () => {
    try {
      setLoading(true)

      const copilotKey = provider?.apiKeys.find((k) => k.label === 'Copilot')
      if (copilotKey) {
        await deleteApiKey(copilotKey.id)
      }

      await updateProvider({
        providerSettings: {
          ...provider?.settings,
          isAuthed: false,
          oauthUsername: '',
          oauthAvatar: ''
        }
      })

      await window.api.copilot.logout()

      updateState({ username: '', avatar: '', defaultHeaders: {} })

      setAuthStatus(AuthStatus.NOT_STARTED)
      setDeviceCode('')
      setUserCode('')
      setVerificationUri('')
      setVerificationPageOpened(false)
      setCurrentStep(0)

      window.toast.success(t('settings.provider.copilot.logout_success'))
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      window.toast.error(t('settings.provider.copilot.logout_failed'))
    } finally {
      setLoading(false)
    }
  }, [t, provider?.apiKeys, provider?.settings, deleteApiKey, updateProvider, updateState])

  const handleCopyUserCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(userCode)
      window.toast.success(t('common.copied'))
    } catch (error) {
      logger.error('Failed to copy to clipboard:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [userCode, t])

  const handleOpenVerificationPage = useCallback(() => {
    if (verificationUri) {
      window.open(verificationUri, '_blank')
      setVerificationPageOpened(true)
      setCurrentStep(2)
    }
  }, [verificationUri])

  const getSteps = () => [
    {
      title: t('settings.provider.copilot.step_get_code'),
      description: t('settings.provider.copilot.step_get_code_desc'),
      status: (currentStep > 0 ? 'finish' : currentStep === 0 ? 'process' : 'wait') as
        | 'error'
        | 'finish'
        | 'process'
        | 'wait'
    },
    {
      title: t('settings.provider.copilot.step_copy_code'),
      description: t('settings.provider.copilot.step_copy_code_desc'),
      status: (currentStep > 1 ? 'finish' : currentStep === 1 ? 'process' : 'wait') as
        | 'error'
        | 'finish'
        | 'process'
        | 'wait'
    },
    {
      title: t('settings.provider.copilot.step_authorize'),
      description: t('settings.provider.copilot.step_authorize_desc'),
      status: (currentStep > 2 ? 'finish' : currentStep === 2 ? 'process' : 'wait') as
        | 'error'
        | 'finish'
        | 'process'
        | 'wait'
    },
    {
      title: t('settings.provider.copilot.step_connect'),
      description: t('settings.provider.copilot.step_connect_desc'),
      status: (currentStep >= 3 ? 'finish' : 'wait') as 'error' | 'finish' | 'process' | 'wait'
    }
  ]

  const handleRateLimitChange = async (value: number) => {
    try {
      await updateProvider({ providerSettings: { ...provider?.settings, rateLimit: value } })
    } catch (error) {
      logger.error('Failed to save Copilot rate limit', { providerId, error })
      window.toast.error(t('settings.provider.save_failed'))
      setRateLimit(providerRateLimit)
      rateLimitRef.current = providerRateLimit
    }
  }

  const stepDotClass = (status: 'finish' | 'process' | 'wait' | 'error') =>
    cn(
      'mt-0.5 mb-0.5 size-2.5 shrink-0 rounded-full border-2 border-background',
      status === 'finish' && 'bg-primary',
      status === 'process' && 'bg-primary ring-2 ring-primary/30',
      status === 'wait' && 'bg-muted',
      status === 'error' && 'bg-destructive'
    )

  const renderAuthContent = () => {
    switch (authStatus) {
      case AuthStatus.AUTHENTICATED:
        return (
          <div className="mb-5">
            <div className="flex gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {avatar ? <img src={avatar} alt="" className="size-5 shrink-0 rounded-full" loading="lazy" /> : null}
                  <span className="truncate text-foreground text-sm">
                    {username || t('settings.provider.copilot.auth_success_title')}
                  </span>
                </div>
                <Button variant="destructive" size="sm" disabled={loading} onClick={handleLogout}>
                  {t('settings.provider.copilot.logout')}
                </Button>
              </div>
            </div>
          </div>
        )

      case AuthStatus.CODE_GENERATED:
        return (
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:gap-6">
            <div className="flex min-w-[200px] flex-1 flex-col gap-2">
              {getSteps().map((step, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className={stepDotClass(step.status)} />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground text-sm leading-tight">{step.title}</div>
                    <div className="mt-1 text-muted-foreground text-xs leading-snug">{step.description}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex min-w-0 flex-[2] flex-col gap-4">
              {currentStep >= 1 && (
                <div className="rounded-lg border border-border bg-muted/40 p-4 transition-colors hover:border-border/80">
                  <div className="mb-3 flex items-start gap-3">
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full font-bold text-primary-foreground text-xs',
                        currentStep > 1 ? 'bg-primary' : 'bg-primary'
                      )}>
                      2
                    </span>
                    <div>
                      <div className="font-medium text-foreground text-sm">
                        {t('settings.provider.copilot.step_copy_code')}
                      </div>
                      <div className="mt-0.5 text-muted-foreground text-xs">
                        {t('settings.provider.copilot.step_copy_code_detail')}
                      </div>
                    </div>
                  </div>
                  <div className="flex min-h-6 flex-row items-center justify-between">
                    <Input value={userCode} readOnly className="mr-2 font-mono font-semibold text-sm" />
                    <Button type="button" variant="secondary" onClick={handleCopyUserCode}>
                      <Copy className="size-4" />
                      {t('common.copy')}
                    </Button>
                  </div>
                </div>
              )}

              {currentStep >= 1 && (
                <div className="rounded-lg border border-border bg-muted/40 p-4 transition-colors hover:border-border/80">
                  <div className="mb-3 flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground text-xs">
                      3
                    </span>
                    <div>
                      <div className="font-medium text-foreground text-sm">
                        {t('settings.provider.copilot.step_authorize')}
                      </div>
                      <div className="mt-0.5 text-muted-foreground text-xs">
                        {t('settings.provider.copilot.step_authorize_detail')}
                      </div>
                    </div>
                  </div>
                  <Button type="button" variant="secondary" className="mb-2" onClick={handleOpenVerificationPage}>
                    {t('settings.provider.copilot.open_verification_page')}
                  </Button>
                  {verificationUri ? (
                    <p className="ml-1 break-all text-muted-foreground text-xs">{verificationUri}</p>
                  ) : null}
                </div>
              )}

              {currentStep >= 2 && (
                <div className="rounded-lg border border-border bg-muted/40 p-4 transition-colors hover:border-border/80">
                  <div className="mb-3 flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground text-xs">
                      4
                    </span>
                    <div>
                      <div className="font-medium text-foreground text-sm">
                        {t('settings.provider.copilot.step_connect')}
                      </div>
                      <div className="mt-0.5 text-muted-foreground text-xs">
                        {t('settings.provider.copilot.step_connect_detail')}
                      </div>
                    </div>
                  </div>
                  <Tooltip
                    content={!verificationPageOpened ? t('settings.provider.copilot.open_verification_first') : ''}>
                    <Button disabled={!verificationPageOpened || loading} onClick={handleGetToken}>
                      {t('settings.provider.copilot.connect')}
                    </Button>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        )

      default:
        return (
          <div className="mb-5">
            <div className="flex gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground text-sm">{t('settings.provider.copilot.description')}</div>
                <div className="mt-1 text-muted-foreground text-xs">
                  {t('settings.provider.copilot.description_detail')}
                </div>
              </div>
              <Button disabled={loading} onClick={handleGetDeviceCode}>
                {t('settings.provider.copilot.start_auth')}
              </Button>
            </div>
          </div>
        )
    }
  }

  return (
    <div className="pt-[15px]">
      {renderAuthContent()}
      {authStatus === AuthStatus.AUTHENTICATED && (
        <div className="mt-5 flex min-h-6 flex-row items-center justify-between">
          <ProviderSettingsSubtitle className="mt-0">
            {t('settings.provider.copilot.rate_limit')}
          </ProviderSettingsSubtitle>
          <div
            className="w-[200px]"
            onPointerUp={() => {
              void handleRateLimitChange(rateLimitRef.current)
            }}>
            <Slider
              className="w-full"
              value={[rateLimit]}
              min={1}
              max={60}
              step={1}
              marks={[
                { value: 1, label: '1' },
                { value: 10, label: t('common.default') },
                { value: 60, label: '60' }
              ]}
              onValueChange={([v]) => {
                setRateLimit(v)
                rateLimitRef.current = v
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default GithubCopilotSettings
