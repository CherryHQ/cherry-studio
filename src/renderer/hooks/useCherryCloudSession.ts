import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type CherryCloudStatusLoadState = 'error' | 'loading' | 'ready'

type CherryCloudSessionAction = 'cancel' | 'login' | 'revoke'

export function useCherryCloudSession(enabled = true) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<CherryCloudStatus | null>(null)
  const [loadState, setLoadState] = useState<CherryCloudStatusLoadState>('loading')
  const [pendingAction, setPendingAction] = useState<CherryCloudSessionAction | null>(null)
  const requestRef = useRef(0)

  const applyStatus = useCallback((nextStatus: CherryCloudStatus) => {
    setStatus(nextStatus)
    setLoadState('ready')
  }, [])

  useIpcOn('cherry_cloud.status_changed', (nextStatus) => {
    if (!enabled) return
    requestRef.current += 1
    applyStatus(nextStatus)
  })

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoadState('loading')
    try {
      const nextStatus = await ipcApi.request('cherry_cloud.status.get')
      if (requestId === requestRef.current) applyStatus(nextStatus)
    } catch {
      if (requestId === requestRef.current) setLoadState('error')
    }
  }, [applyStatus])

  useEffect(() => {
    if (!enabled) return
    void reload()
    return () => {
      requestRef.current += 1
    }
  }, [enabled, reload])

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
        const message =
          action === 'revoke'
            ? t('settings.provider.cherry_cloud.logout_failed')
            : action === 'login' &&
                error instanceof IpcError &&
                error.code === cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE
              ? t('error.http.503')
              : t('settings.provider.cherry_cloud.sign_in_failed')
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
