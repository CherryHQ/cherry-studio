import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { CheckCircle2, CircleAlert, LogIn, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('GrokCliOauth')

interface GrokCliOauthProps {
  providerId: string
}

/**
 * Sign-in panel for the login-based Grok CLI provider. The whole OAuth flow
 * (OIDC discovery + PKCE + loopback callback + token exchange) runs in the main
 * process behind a single `signIn()` call, so this component just drives login
 * state and reflects the result; the access token never reaches the renderer.
 */
const GrokCliOauth: FC<GrokCliOauthProps> = ({ providerId }) => {
  const { t } = useTranslation()
  const { updateProvider } = useProvider(providerId)

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      setLoggedIn(await ipcApi.request('oauth.has_token', { providerId }))
    } catch (error) {
      logger.error('Failed to check Grok CLI login status', error as Error)
      setLoggedIn(false)
    }
  }, [providerId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleSignIn = useCallback(async () => {
    setSigningIn(true)
    try {
      await ipcApi.request('oauth.sign_in', { providerId })
      setLoggedIn(true)
      // The main process enabled the provider; mirror it into the renderer cache.
      await updateProvider({ isEnabled: true })
      window.toast.success(t('settings.provider.grok_cli.sign_in_success'))
    } catch (error) {
      logger.error('Grok CLI sign-in failed', error as Error)
      window.toast.error(t('settings.provider.grok_cli.sign_in_failed'))
    } finally {
      setSigningIn(false)
    }
  }, [providerId, t, updateProvider])

  const handleLogout = useCallback(() => {
    window.modal.confirm({
      title: t('settings.provider.oauth.logout'),
      content: t('settings.provider.oauth.logout_confirm'),
      centered: true,
      onOk: async () => {
        setLoggingOut(true)
        try {
          await ipcApi.request('oauth.logout', { providerId })
          // The main process reset auth to api-key and disabled the provider;
          // mirror it into the renderer cache (DataApi does not auto-sync).
          await updateProvider({ authConfig: { type: 'api-key' }, isEnabled: false })
          setLoggedIn(false)
          window.toast.success(t('settings.provider.oauth.logout_success'))
        } catch (error) {
          logger.error('Grok CLI logout failed', error as Error)
          window.toast.warning(t('settings.provider.oauth.logout_warning'))
        } finally {
          setLoggingOut(false)
        }
      }
    })
  }, [providerId, t, updateProvider])

  if (loggedIn === null) {
    return (
      <div className="flex items-center gap-2 pt-3.75 text-foreground-muted text-xs">
        <RefreshCw className="size-4 animate-spin" aria-hidden />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-3.75">
      {loggedIn ? (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground text-sm">{t('settings.provider.grok_cli.logged_in')}</div>
          </div>
          <Button variant="ghost" size="sm" disabled={loggingOut} onClick={handleLogout}>
            {t('settings.provider.oauth.logout')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground text-sm">{t('settings.provider.grok_cli.description')}</div>
              <div className="mt-1 text-foreground-muted text-xs">
                {t('settings.provider.grok_cli.description_detail')}
              </div>
            </div>
          </div>
          <div>
            <Button disabled={signingIn} onClick={() => void handleSignIn()}>
              {signingIn ? <RefreshCw className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {signingIn ? t('settings.provider.grok_cli.signing_in') : t('settings.provider.grok_cli.sign_in_button')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default GrokCliOauth
