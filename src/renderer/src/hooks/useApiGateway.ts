import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setApiGatewayEnabled as setApiGatewayEnabledAction } from '@renderer/store/settings'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useApiGateway')

// Module-level single instance subscription to prevent EventEmitter memory leak
// Only one IPC listener will be registered regardless of how many components use this hook
const onReadyCallbacks = new Set<() => void>()
let removeIpcListener: (() => void) | null = null

const ensureIpcSubscribed = () => {
  if (!removeIpcListener) {
    removeIpcListener = window.api.apiGateway.onReady(() => {
      onReadyCallbacks.forEach((cb) => cb())
    })
  }
}

const cleanupIpcIfEmpty = () => {
  if (onReadyCallbacks.size === 0 && removeIpcListener) {
    removeIpcListener()
    removeIpcListener = null
  }
}

export const useApiGateway = () => {
  const { t } = useTranslation()
  // FIXME: We currently store two copies of the config data in both the renderer and the main processes,
  // which carries the risk of data inconsistency. This should be modified so that the main process stores
  // the data, and the renderer retrieves it.
  const apiGatewayConfig = useAppSelector((state) => state.settings.apiGateway)
  const dispatch = useAppDispatch()

  // Initial state - no longer optimistic, wait for actual status
  const [apiGatewayRunning, setApiGatewayRunning] = useState(false)
  const [apiGatewayLoading, setApiGatewayLoading] = useState(true)

  const setApiGatewayEnabled = useCallback(
    (enabled: boolean) => {
      dispatch(setApiGatewayEnabledAction(enabled))
    },
    [dispatch]
  )

  // API Server functions
  const checkApiGatewayStatus = useCallback(async () => {
    setApiGatewayLoading(true)
    try {
      const status = await window.api.apiGateway.getStatus()
      setApiGatewayRunning(status.running)
      if (status.running && !apiGatewayConfig.enabled) {
        setApiGatewayEnabled(true)
      }
    } catch (error: any) {
      logger.error('Failed to check API server status:', error)
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayConfig.enabled, setApiGatewayEnabled])

  const startApiGateway = useCallback(async () => {
    if (apiGatewayLoading) return
    setApiGatewayLoading(true)
    try {
      const result = await window.api.apiGateway.start()
      if (result.success) {
        setApiGatewayRunning(true)
        setApiGatewayEnabled(true)
        window.toast.success(t('apiGateway.messages.startSuccess'))
      } else {
        window.toast.error(t('apiGateway.messages.startError') + result.error)
      }
    } catch (error: any) {
      window.toast.error(t('apiGateway.messages.startError') + (error.message || error))
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, setApiGatewayEnabled, t])

  const stopApiGateway = useCallback(async () => {
    if (apiGatewayLoading) return
    setApiGatewayLoading(true)
    try {
      const result = await window.api.apiGateway.stop()
      if (result.success) {
        setApiGatewayRunning(false)
        setApiGatewayEnabled(false)
        window.toast.success(t('apiGateway.messages.stopSuccess'))
      } else {
        window.toast.error(t('apiGateway.messages.stopError') + result.error)
      }
    } catch (error: any) {
      window.toast.error(t('apiGateway.messages.stopError') + (error.message || error))
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, setApiGatewayEnabled, t])

  const restartApiGateway = useCallback(async () => {
    if (apiGatewayLoading) return
    setApiGatewayLoading(true)
    try {
      const result = await window.api.apiGateway.restart()
      setApiGatewayEnabled(result.success)
      if (result.success) {
        await checkApiGatewayStatus()
        window.toast.success(t('apiGateway.messages.restartSuccess'))
      } else {
        window.toast.error(t('apiGateway.messages.restartError') + result.error)
      }
    } catch (error) {
      window.toast.error(t('apiGateway.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, checkApiGatewayStatus, setApiGatewayEnabled, t])

  useEffect(() => {
    checkApiGatewayStatus()
  }, [checkApiGatewayStatus])

  // Use ref to keep the latest checkApiGatewayStatus without causing re-subscription
  const checkStatusRef = useRef(checkApiGatewayStatus)
  useEffect(() => {
    checkStatusRef.current = checkApiGatewayStatus
  })

  // Create stable callback for the single instance subscription
  const handleReady = useCallback(() => {
    logger.info('API server ready event received, checking status')
    checkStatusRef.current()
  }, [])

  // Listen for API server ready event using single instance subscription
  useEffect(() => {
    ensureIpcSubscribed()
    onReadyCallbacks.add(handleReady)

    return () => {
      onReadyCallbacks.delete(handleReady)
      cleanupIpcIfEmpty()
    }
  }, [handleReady])

  return {
    apiGatewayConfig,
    apiGatewayRunning,
    apiGatewayLoading,
    startApiGateway,
    stopApiGateway,
    restartApiGateway,
    checkApiGatewayStatus,
    setApiGatewayEnabled
  }
}
