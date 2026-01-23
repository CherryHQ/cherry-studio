import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useApiServer')

// Module-level single instance subscription to prevent EventEmitter memory leak
// Only one IPC listener will be registered regardless of how many components use this hook
const onReadyCallbacks = new Set<() => void>()
let removeIpcListener: (() => void) | null = null

const ensureIpcSubscribed = () => {
  if (!removeIpcListener) {
    removeIpcListener = window.api.apiServer.onReady(() => {
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

export const useApiServer = () => {
  const { t } = useTranslation()

  // Use new preference system for API server configuration
  const [apiServerConfig, setApiServerConfig] = useMultiplePreferences({
    enabled: 'feature.csaas.enabled',
    host: 'feature.csaas.host',
    port: 'feature.csaas.port',
    apiKey: 'feature.csaas.api_key'
  })

  // Initial state - no longer optimistic, wait for actual status
  const [apiServerRunning, setApiServerRunning] = useState(false)
  const [apiServerLoading, setApiServerLoading] = useState(true)

  const setApiServerEnabled = useCallback(
    (enabled: boolean) => {
      setApiServerConfig({ enabled })
    },
    [setApiServerConfig]
  )

  // API Server functions
  const checkApiServerStatus = useCallback(async () => {
    setApiServerLoading(true)
    try {
      const status = await window.api.apiServer.getStatus()
      setApiServerRunning(status.running)
      // if (status.running && !apiServerConfig.enabled) {
      //   setApiServerEnabled(true)
      // }
    } catch (error: any) {
      logger.error('Failed to check API server status:', error)
    } finally {
      setApiServerLoading(false)
    }
  }, [])

  const startApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.start()
      if (result.success) {
        setApiServerRunning(true)
        setApiServerEnabled(true)
        window.toast.success(t('apiServer.messages.startSuccess'))
      } else {
        window.toast.error(t('apiServer.messages.startError') + result.error)
      }
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.startError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, setApiServerEnabled, t])

  const stopApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.stop()
      if (result.success) {
        setApiServerRunning(false)
        setApiServerEnabled(false)
        window.toast.success(t('apiServer.messages.stopSuccess'))
      } else {
        window.toast.error(t('apiServer.messages.stopError') + result.error)
      }
    } catch (error: any) {
      window.toast.error(t('apiServer.messages.stopError') + (error.message || error))
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, setApiServerEnabled, t])

  const restartApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      const result = await window.api.apiServer.restart()
      setApiServerEnabled(result.success)
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
  }, [apiServerLoading, checkApiServerStatus, setApiServerEnabled, t])

  useEffect(() => {
    checkApiServerStatus()
  }, [checkApiServerStatus])

  // Use ref to keep the latest checkApiServerStatus without causing re-subscription
  const checkStatusRef = useRef(checkApiServerStatus)
  useEffect(() => {
    checkStatusRef.current = checkApiServerStatus
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
    apiServerConfig,
    apiServerRunning,
    apiServerLoading,
    startApiServer,
    stopApiServer,
    restartApiServer,
    checkApiServerStatus,
    setApiServerEnabled,
    setApiServerConfig
  }
}
