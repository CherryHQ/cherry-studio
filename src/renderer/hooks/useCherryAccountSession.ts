import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

type CherryCloudStatusLoadState = 'error' | 'loading' | 'ready'

type CherryCloudSessionAction = 'cancel' | 'login' | 'revoke'

export function useCherryAccountSession(enabled = true) {
  const { t } = useTranslation()
  const {
    data: status = null,
    error,
    mutate
  } = useSWR(enabled ? 'cherry-cloud/account-status' : null, () => ipcApi.request('cherry_cloud.status.get'), {
    shouldRetryOnError: false
  })
  const loadState: CherryCloudStatusLoadState = status ? 'ready' : error ? 'error' : 'loading'
  const [pendingAction, setPendingAction] = useState<CherryCloudSessionAction | null>(null)
  const requestRef = useRef(0)

  const applyStatus = useCallback(
    (nextStatus: CherryCloudStatus) => {
      void mutate(nextStatus, { revalidate: false })
    },
    [mutate]
  )

  useIpcOn('cherry_cloud.status_changed', (nextStatus) => {
    if (!enabled) return
    requestRef.current += 1
    applyStatus(nextStatus)
  })

  const reload = useCallback(async () => {
    await mutate().catch(() => {})
  }, [mutate])

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
        const nextStatus = await ipcApi.request(
          action === 'login'
            ? 'cherry_cloud.login.start'
            : action === 'cancel'
              ? 'cherry_cloud.login.cancel'
              : 'cherry_cloud.session.revoke'
        )
        if (requestId === requestRef.current) applyStatus(nextStatus)
      } catch (error) {
        if (requestId !== requestRef.current) return
        let message = t(
          action === 'revoke'
            ? 'settings.provider.cherry_cloud.logout_failed'
            : 'settings.provider.cherry_cloud.sign_in_failed'
        )
        if (action === 'login' && error instanceof IpcError) {
          if (error.code === cherryCloudErrorCodes.UPGRADE_REQUIRED) {
            message = t('settings.provider.cherry_cloud.upgrade_required')
          } else if (error.code === cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE) {
            message = t('error.http.503')
          }
        }
        toast.error(message)
      } finally {
        setPendingAction((current) => (current === action ? null : current))
      }
    },
    [applyStatus, t]
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
