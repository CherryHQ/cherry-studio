import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'

const logger = loggerService.withContext('AnthropicSettings')

enum AuthStatus {
  NOT_STARTED,
  AUTHENTICATING,
  AUTHENTICATED
}

type StatusBlockType = 'info' | 'success' | 'warning'

const statusBlockClasses: Record<StatusBlockType, string> = {
  info: 'border-[color:var(--color-border-info-soft)] bg-[var(--color-surface-info-soft)]',
  success:
    'border-[color:color-mix(in_srgb,var(--primary)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--primary)_8%,var(--background))]',
  warning: 'border-[color:var(--color-border-warning-soft)] bg-[var(--color-surface-warning-soft)]'
}

const statusIconClasses: Record<StatusBlockType, string> = {
  info: 'text-foreground/65',
  success: 'text-primary',
  warning: 'text-destructive'
}

const StatusIcon = ({ type }: { type: StatusBlockType }) => {
  const className = statusIconClasses[type]

  switch (type) {
    case 'success':
      return <CheckCircle2 className={className} size={16} />
    case 'warning':
      return <TriangleAlert className={className} size={16} />
    default:
      return <Info className={className} size={16} />
  }
}

const StatusBlock = ({
  type,
  title,
  description,
  action
}: {
  type: StatusBlockType
  title: string
  description?: string
  action?: ReactNode
}) => (
  <div className={`rounded-2xl border px-4 py-3 ${statusBlockClasses[type]}`}>
    <div className="flex min-w-0 items-start gap-3">
      <div className="mt-0.5 shrink-0">
        <StatusIcon type={type} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-md)] text-foreground/85 leading-[var(--line-height-body-md)]">
          {title}
        </div>
        {description ? (
          <div className="mt-1 text-[length:var(--font-size-body-sm)] text-muted-foreground/80 leading-[var(--line-height-body-sm)]">
            {description}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  </div>
)

const AnthropicSettings = () => {
  const { t } = useTranslation()
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.NOT_STARTED)
  const [loading, setLoading] = useState<boolean>(false)
  const [codeModalVisible, setCodeModalVisible] = useState<boolean>(false)
  const [authCode, setAuthCode] = useState<string>('')

  // Check initial auth status.
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const hasCredentials = await window.api.anthropic_oauth.hasCredentials()

        if (hasCredentials) {
          setAuthStatus(AuthStatus.AUTHENTICATED)
        }
      } catch (error) {
        logger.error('Failed to check authentication status:', error as Error)
      }
    }

    void checkAuthStatus()
  }, [])

  // Start OAuth redirect flow.
  const handleRedirectOAuth = async () => {
    try {
      setLoading(true)
      await window.api.anthropic_oauth.startOAuthFlow()
      setAuthStatus(AuthStatus.AUTHENTICATING)
      setCodeModalVisible(true)
    } catch (error) {
      logger.error('OAuth redirect failed:', error as Error)
      window.toast.error(t('settings.provider.anthropic.auth_failed'))
    } finally {
      setLoading(false)
    }
  }

  // Submit authorization code.
  const handleSubmitCode = async () => {
    logger.info('Submitting auth code')
    try {
      setLoading(true)
      await window.api.anthropic_oauth.completeOAuthWithCode(authCode)
      setAuthStatus(AuthStatus.AUTHENTICATED)
      setCodeModalVisible(false)
      window.toast.success(t('settings.provider.anthropic.auth_success'))
    } catch (error) {
      logger.error('Code submission failed:', error as Error)
      window.toast.error(t('settings.provider.anthropic.code_error'))
    } finally {
      setLoading(false)
    }
  }

  // Cancel authentication.
  const handleCancelAuth = () => {
    void window.api.anthropic_oauth.cancelOAuthFlow()
    setAuthStatus(AuthStatus.NOT_STARTED)
    setCodeModalVisible(false)
    setAuthCode('')
  }

  // Log out.
  const handleLogout = async () => {
    try {
      await window.api.anthropic_oauth.clearCredentials()
      setAuthStatus(AuthStatus.NOT_STARTED)
      window.toast.success(t('settings.provider.anthropic.logout_success'))
    } catch (error) {
      logger.error('Logout failed:', error as Error)
      window.toast.error(t('settings.provider.anthropic.logout_failed'))
    }
  }

  // Render authentication state.
  const renderAuthContent = () => {
    switch (authStatus) {
      case AuthStatus.AUTHENTICATED:
        return (
          <div className="mb-2.5">
            <StatusBlock
              type="success"
              title={t('settings.provider.anthropic.authenticated')}
              action={<Button onClick={handleLogout}>{t('settings.provider.anthropic.logout')}</Button>}
            />
          </div>
        )
      case AuthStatus.AUTHENTICATING:
        return (
          <div className="mb-2.5">
            <StatusBlock type="info" title={t('settings.provider.anthropic.authenticating')} />
            <Dialog open={codeModalVisible} onOpenChange={(open) => !open && handleCancelAuth()}>
              <DialogContent className="provider-settings-default-scope gap-5 rounded-2xl border-[color:var(--color-border-fg-muted)] bg-popover p-5 sm:max-w-md">
                <DialogHeader className="gap-1.5 pr-6">
                  <DialogTitle className="text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]">
                    {t('settings.provider.anthropic.enter_auth_code')}
                  </DialogTitle>
                </DialogHeader>
                <Input
                  className={drawerClasses.input}
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder={t('settings.provider.anthropic.code_placeholder')}
                  disabled={loading}
                />
                <DialogFooter>
                  <Button variant="outline" onClick={handleCancelAuth}>
                    {t('settings.provider.anthropic.cancel')}
                  </Button>
                  <Button disabled={loading || !authCode.trim()} onClick={() => void handleSubmitCode()}>
                    {t('settings.provider.anthropic.submit_code')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )
      default:
        return (
          <div className="mb-2.5">
            <StatusBlock
              type="info"
              title={t('settings.provider.anthropic.description')}
              description={t('settings.provider.anthropic.description_detail')}
              action={
                <Button disabled={loading} onClick={handleRedirectOAuth}>
                  {t('settings.provider.anthropic.start_auth')}
                </Button>
              }
            />
          </div>
        )
    }
  }

  return (
    <div className="provider-settings-default-scope pt-2.5">
      <div className="mb-2.5">
        <StatusBlock type="warning" title={t('settings.provider.anthropic.oauth_disabled_warning')} />
      </div>
      {renderAuthContent()}
    </div>
  )
}

export default AnthropicSettings
