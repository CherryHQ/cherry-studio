import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage } from '@renderer/utils/cherryCloudSignIn'

import { useCherryCloudReceipt } from './useCherryCloudReceipt'

type CherryCloudStatusLoadState = 'error' | 'loading' | 'ready'

type CherryCloudSessionAction = 'cancel' | 'login' | 'revoke'

export function useCherryAccountSession(enabled = true) {
  const { t } = useTranslation()
  const { receipt, error, reload: reloadReceipt } = useCherryCloudReceipt(enabled)
  const status = receipt?.status ?? null
  const loadState: CherryCloudStatusLoadState = status ? 'ready' : error ? 'error' : 'loading'
  const [pendingAction, setPendingAction] = useState<CherryCloudSessionAction | null>(null)
  const requestRef = useRef(0)

  const reload = useCallback(async () => {
    await reloadReceipt().catch(() => {})
  }, [reloadReceipt])

  useEffect(() => {
    return () => {
      requestRef.current += 1
    }
  }, [enabled])

  const runAction = useCallback(
    async (action: CherryCloudSessionAction) => {
      const requestId = ++requestRef.current
      setPendingAction(action)
      try {
        if (action === 'login') await ipcApi.request('cherry_cloud.login.start')
        else await ipcApi.request(action === 'cancel' ? 'cherry_cloud.login.cancel' : 'cherry_cloud.session.revoke')
        if (requestId === requestRef.current) await reloadReceipt()
      } catch (error) {
        if (requestId !== requestRef.current) return
        toast.error(
          action === 'login'
            ? getCherryCloudSignInErrorMessage(error, t)
            : t(
                action === 'revoke'
                  ? 'settings.provider.cherry_cloud.logout_failed'
                  : 'settings.provider.cherry_cloud.sign_in_failed'
              )
        )
      } finally {
        if (requestId === requestRef.current) setPendingAction(null)
      }
    },
    [reloadReceipt, t]
  )

  const login = useCallback(() => runAction('login'), [runAction])
  const cancelLogin = useCallback(() => runAction('cancel'), [runAction])
  const revokeSession = useCallback(() => runAction('revoke'), [runAction])

  return {
    status,
    loadState,
    reload,
    login,
    cancelLogin,
    revokeSession,
    isStartingLogin: pendingAction === 'login',
    isCancellingLogin: pendingAction === 'cancel',
    isRevokingSession: pendingAction === 'revoke',
    isAuthorizing: status?.phase === 'authorizing' || pendingAction === 'login'
  }
}
