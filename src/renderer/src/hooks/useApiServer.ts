import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setApiServerEnabled as setApiServerEnabledAction } from '@renderer/store/settings'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useApiServer')

export const useApiServer = () => {
  const { t } = useTranslation()
  const apiServerConfig = useAppSelector((state) => state.settings.apiServer)
  const dispatch = useAppDispatch()

  const [apiServerRunning, setApiServerRunning] = useState(false)
  const [apiServerLoading, setApiServerLoading] = useState(false)

  const setApiServerEnabled = useCallback(
    (enabled: boolean) => {
      dispatch(setApiServerEnabledAction(enabled))
    },
    [dispatch]
  )

  // API Server functions
  const checkApiServerStatus = useCallback(async () => {
    try {
      const status = await window.api.apiServer.getStatus()
      setApiServerRunning(status.running)
    } catch (error: any) {
      logger.error('Failed to check API server status:', error)
    }
  }, [])

  const startApiServer = useCallback(async () => {
    if (apiServerLoading) return

    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.start()
      if (result.success) {
        setApiServerRunning(true)
        window.toast.success(t('apiServer.messages.startSuccess'))
      } else {
        window.toast.error(t('apiServer.messages.startError') + result.error)
      }
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.startError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, t])

  const stopApiServer = useCallback(async () => {
    if (apiServerLoading) return

    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.stop()
      if (result.success) {
        setApiServerRunning(false)
        window.toast.success(t('apiServer.messages.stopSuccess'))
      } else {
        window.toast.error(t('apiServer.messages.stopError') + result.error)
      }
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.stopError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, t])

  const restartApiServer = useCallback(async () => {
    if (apiServerLoading) return

    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.restart()
      if (result.success) {
        await checkApiServerStatus()
        window.toast.success(t('apiServer.messages.restartSuccess'))
      } else {
        window.toast.error(t('apiServer.messages.restartError') + result.error)
      }
    } catch (error) {
      window.toast.error(t('apiServer.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, checkApiServerStatus, t])

  useEffect(() => {
    checkApiServerStatus()
  }, [checkApiServerStatus])

  return {
    apiServerConfig,
    apiServerRunning,
    apiServerLoading,
    startApiServer,
    stopApiServer,
    restartApiServer,
    checkApiServerStatus,
    setApiServerEnabled
  }
}
