import { CheckCircle2, CircleAlert, LogIn, RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

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
  const invalidateCache = useInvalidateCache()
  const ns = `settings.provider.${i18nNs}`

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [cancellingSignIn, setCancellingSignIn] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const mountedRef = useRef(false)
  const signInRequestRef = useRef<Promise<void> | null>(null)
  const signInRequestIdRef = useRef<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshProviderData = useCallback(
    () => invalidateCache(['/providers', `/providers/${providerId}`, `/providers/${providerId}/*`]),
    [invalidateCache, providerId]
  )

  const applySignInSuccess = useCallback(
    async (account: { accountId: string | null }) => {
      if (mountedRef.current) {
        setLoggedIn(true)
        setAccountId(account.accountId)
      }
      // The main process owns the write; revalidate this window's DataApi reads.
      await refreshProviderData()
      if (mountedRef.current) toast.success(t(`${ns}.sign_in_success`))
    },
    [ns, refreshProviderData, t]
  )

  const startSignIn = useCallback((): Promise<void> => {
    const existing = signInRequestRef.current
    if (existing) return existing

    setSigningIn(true)
    const requestId = crypto.randomUUID()
    signInRequestIdRef.current = requestId
    const request = Promise.resolve().then(async () => {
      try {
        const account = await ipcApi.request('oauth.sign_in', { providerId, requestId })
        await applySignInSuccess(account)
      } catch (error) {
        if (error instanceof IpcError && error.code === oauthErrorCodes.SIGN_IN_CANCELLED) return
        if (!mountedRef.current) return
        logger.error(`${providerId} sign-in failed`, error as Error)
        toast.error(t(`${ns}.sign_in_failed`))
      } finally {
        if (signInRequestRef.current === request) {
          signInRequestRef.current = null
          if (signInRequestIdRef.current === requestId) signInRequestIdRef.current = null
          if (mountedRef.current) setSigningIn(false)
        }
      }
    })
    signInRequestRef.current = request
    return request
  }, [applySignInSuccess, providerId, ns, t])

  const attachActiveSignIn = useCallback(async () => {
    const requestId = crypto.randomUUID()
    signInRequestIdRef.current = requestId
    setSigningIn(true)
    try {
      const result = await ipcApi.request('oauth.sign_in.attach', { providerId, requestId })
      if (result.status === 'completed') {
        await applySignInSuccess(result.account)
        return
      }

      const hasToken = await ipcApi.request('oauth.has_token', { providerId })
      if (!mountedRef.current) return
      if (hasToken) {
        const account = showAccountId ? await ipcApi.request('oauth.get_account', { providerId }) : { accountId: null }
        await applySignInSuccess(account)
        return
      }

      setLoggedIn(false)
      setAccountId(null)
    } catch (error) {
      if (error instanceof IpcError && error.code === oauthErrorCodes.SIGN_IN_CANCELLED) return
      if (!mountedRef.current) return
      logger.error(`${providerId} attached sign-in failed`, error as Error)
      toast.error(t(`${ns}.sign_in_failed`))
    } finally {
      if (signInRequestIdRef.current === requestId) {
        signInRequestIdRef.current = null
        if (mountedRef.current) setSigningIn(false)
      }
    }
  }, [applySignInSuccess, ns, providerId, showAccountId, t])

  const refreshStatus = useCallback(async () => {
    try {
      const hasToken = await ipcApi.request('oauth.has_token', { providerId })
      setLoggedIn(hasToken)
      if (hasToken) {
        setAccountId(showAccountId ? (await ipcApi.request('oauth.get_account', { providerId })).accountId : null)
        return
      }

      setLoggedIn(false)
      setAccountId(null)
      await attachActiveSignIn()
    } catch (error) {
      logger.error(`Failed to check ${providerId} login status`, error as Error)
      setLoggedIn(false)
    }
  }, [attachActiveSignIn, providerId, showAccountId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleCancelSignIn = useCallback(async () => {
    const requestId = signInRequestIdRef.current
    if (!requestId) return

    setCancellingSignIn(true)
    try {
      await ipcApi.request('oauth.cancel_sign_in', { providerId, requestId })
    } catch (error) {
      logger.error(`Failed to cancel ${providerId} sign-in`, error as Error)
      toast.error(t(`${ns}.sign_in_failed`))
    } finally {
      if (mountedRef.current) setCancellingSignIn(false)
    }
  }, [ns, providerId, t])

  const handleLogout = useCallback(async () => {
    const confirmed = await popup.confirm({
      title: t('settings.provider.oauth.logout'),
      content: t('settings.provider.oauth.logout_confirm'),
      centered: true
    })
    if (!confirmed) return

    setLoggingOut(true)
    try {
      await ipcApi.request('oauth.logout', { providerId })
      await refreshProviderData()
      setLoggedIn(false)
      setAccountId(null)
      toast.success(t('settings.provider.oauth.logout_success'))
    } catch (error) {
      logger.error(`${providerId} logout failed`, error as Error)
      toast.warning(t('settings.provider.oauth.logout_warning'))
    } finally {
      setLoggingOut(false)
    }
  }, [providerId, refreshProviderData, t])

  if (loggedIn === null) {
    return (
      <div className="flex items-center gap-2 pt-3.75 text-foreground-tertiary text-xs">
        <RefreshCw className="size-4 animate-spin" aria-hidden />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {loggedIn ? (
        <div className="flex items-center gap-3 rounded-lg border border-success-border bg-success-subtle p-3 text-success-subtle-foreground">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm">{t(`${ns}.logged_in`)}</div>
            {showAccountId && accountId ? (
              <div className="mt-1 truncate text-xs">{t(`${ns}.account`, { accountId })}</div>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" disabled={loggingOut} onClick={handleLogout}>
            {t('settings.provider.oauth.logout')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-info-border bg-info-subtle p-3 text-info-subtle-foreground">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm">{t(`${ns}.description`)}</div>
              <div className="mt-1 text-xs">{t(`${ns}.description_detail`)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={signingIn} onClick={() => void startSignIn()}>
              {signingIn ? <RefreshCw className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {signingIn ? t(`${ns}.signing_in`) : t(`${ns}.sign_in_button`)}
            </Button>
            {signingIn ? (
              <Button variant="outline" disabled={cancellingSignIn} onClick={() => void handleCancelSignIn()}>
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export default LoginOauthPanel
