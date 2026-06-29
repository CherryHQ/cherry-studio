import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { CheckCircle2, CircleAlert, LogIn, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('LoginOauthPanel')

interface LoginOauthPanelProps {
  providerId: string
  /** i18n namespace under `settings.provider.*` (e.g. 'codex', 'grok_cli'). */
  i18nNs: string
  /** Surface the provider account id (Codex's ChatGPT id) when signed in. */
  showAccountId?: boolean
}

/**
 * Shared sign-in panel for login-based providers whose entire OAuth flow (PKCE +
 * loopback callback + token exchange) runs in the main process behind a single
 * `oauth.sign_in` call. This component only drives login state and reflects the
 * result — the access token never reaches the renderer. Codex and Grok CLI use it
 * with different i18n namespaces; Codex additionally surfaces an account id.
 */
const LoginOauthPanel: FC<LoginOauthPanelProps> = ({ providerId, i18nNs, showAccountId = false }) => {
  const { t } = useTranslation()
  const { updateProvider } = useProvider(providerId)
  const ns = `settings.provider.${i18nNs}`

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const hasToken = await ipcApi.request('oauth.has_token', { providerId })
      setLoggedIn(hasToken)
      setAccountId(
        hasToken && showAccountId ? (await ipcApi.request('oauth.get_account', { providerId })).accountId : null
      )
    } catch (error) {
      logger.error(`Failed to check ${providerId} login status`, error as Error)
      setLoggedIn(false)
    }
  }, [providerId, showAccountId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleSignIn = useCallback(async () => {
    setSigningIn(true)
    try {
      const account = await ipcApi.request('oauth.sign_in', { providerId })
      setLoggedIn(true)
      setAccountId(account.accountId)
      // The main process enabled the provider; mirror it into the renderer cache.
      await updateProvider({ isEnabled: true })
      window.toast.success(t(`${ns}.sign_in_success`))
    } catch (error) {
      logger.error(`${providerId} sign-in failed`, error as Error)
      window.toast.error(t(`${ns}.sign_in_failed`))
    } finally {
      setSigningIn(false)
    }
  }, [providerId, ns, t, updateProvider])

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
          setAccountId(null)
          window.toast.success(t('settings.provider.oauth.logout_success'))
        } catch (error) {
          logger.error(`${providerId} logout failed`, error as Error)
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
            <div className="font-medium text-foreground text-sm">{t(`${ns}.logged_in`)}</div>
            {showAccountId && accountId ? (
              <div className="mt-1 truncate text-foreground-muted text-xs">{t(`${ns}.account`, { accountId })}</div>
            ) : null}
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
              <div className="font-medium text-foreground text-sm">{t(`${ns}.description`)}</div>
              <div className="mt-1 text-foreground-muted text-xs">{t(`${ns}.description_detail`)}</div>
            </div>
          </div>
          <div>
            <Button disabled={signingIn} onClick={() => void handleSignIn()}>
              {signingIn ? <RefreshCw className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {signingIn ? t(`${ns}.signing_in`) : t(`${ns}.sign_in_button`)}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default LoginOauthPanel
