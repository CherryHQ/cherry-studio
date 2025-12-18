import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setApiServerRunningAction } from '@renderer/store/runtime'
import { setApiServerEnabled as setApiServerEnabledAction } from '@renderer/store/settings'
import type { GetApiServerStatusResult } from '@types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useApiServer')

// 避免大量组件同时挂载时，重复通过 IPC 频繁查询状态导致卡顿与日志刷屏：
// - single-flight：同一时刻只允许一个 in-flight 请求
// - TTL 缓存：短时间内复用上一次结果
const STATUS_CACHE_TTL_MS = 1_000
let cachedStatus: GetApiServerStatusResult | null = null
let cachedStatusAt = 0
let inFlightStatusPromise: Promise<GetApiServerStatusResult> | null = null

const invalidateStatusCache = () => {
  cachedStatus = null
  cachedStatusAt = 0
}

const getStatusSingleFlight = async (options?: { bypassCache?: boolean }): Promise<GetApiServerStatusResult> => {
  const now = Date.now()
  if (!options?.bypassCache && cachedStatus && now - cachedStatusAt < STATUS_CACHE_TTL_MS) {
    return cachedStatus
  }
  if (inFlightStatusPromise) {
    return inFlightStatusPromise
  }

  inFlightStatusPromise = window.api.apiServer
    .getStatus()
    .then((status) => {
      cachedStatus = status
      cachedStatusAt = Date.now()
      return status
    })
    .finally(() => {
      inFlightStatusPromise = null
    })

  return inFlightStatusPromise
}

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
  // FIXME: We currently store two copies of the config data in both the renderer and the main processes,
  // which carries the risk of data inconsistency. This should be modified so that the main process stores
  // the data, and the renderer retrieves it.
  const apiServerConfig = useAppSelector((state) => state.settings.apiServer)
  const dispatch = useAppDispatch()

  const apiServerRunning = useAppSelector((state) => state.runtime.apiServerRunning)
  // Is checking the API server status
  const [apiServerLoading, setApiServerLoading] = useState(true)

  const setApiServerRunning = useCallback(
    (running: boolean) => {
      dispatch(setApiServerRunningAction(running))
    },
    [dispatch]
  )

  const setApiServerEnabled = useCallback(
    (enabled: boolean) => {
      dispatch(setApiServerEnabledAction(enabled))
    },
    [dispatch]
  )

  // API Server functions
  const checkApiServerStatus = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      setApiServerLoading(true)
      try {
        const status = await getStatusSingleFlight(options)
        setApiServerRunning(status.running)
        if (status.running && !apiServerConfig.enabled) {
          setApiServerEnabled(true)
        }
      } catch (error: any) {
        logger.error('Failed to check API server status:', error)
      } finally {
        setApiServerLoading(false)
      }
    },
    [apiServerConfig.enabled, setApiServerEnabled]
  )

  const startApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      invalidateStatusCache()
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
  }, [apiServerLoading, setApiServerEnabled, setApiServerLoading, setApiServerRunning, t])

  const stopApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      invalidateStatusCache()
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
  }, [apiServerLoading, setApiServerEnabled, setApiServerLoading, setApiServerRunning, t])

  const restartApiServer = useCallback(async () => {
    if (apiServerLoading) return
    setApiServerLoading(true)
    try {
      invalidateStatusCache()
      const result = await window.api.apiServer.restart()
      setApiServerEnabled(result.success)
      if (result.success) {
        await checkApiServerStatus({ bypassCache: true })
        window.toast.success(t('apiServer.messages.restartSuccess'))
      } else {
        window.toast.error(t('apiServer.messages.restartError') + result.error)
      }
    } catch (error) {
      window.toast.error(t('apiServer.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiServerLoading(false)
    }
  }, [apiServerLoading, checkApiServerStatus, setApiServerEnabled, setApiServerLoading, t])

  useEffect(() => {
    void checkApiServerStatus()
  }, [checkApiServerStatus])

  // Use ref to keep the latest checkApiServerStatus without causing re-subscription
  const checkStatusRef = useRef(checkApiServerStatus)
  useEffect(() => {
    checkStatusRef.current = checkApiServerStatus
  })

  // Create stable callback for the single instance subscription
  const handleReady = useCallback(() => {
    logger.info('API server ready event received, checking status')
    invalidateStatusCache()
    void checkStatusRef.current({ bypassCache: true })
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
    setApiServerEnabled
  }
}
